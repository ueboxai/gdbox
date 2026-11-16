extends SceneTree

## GDBox 的试玩运行器：不改用户工程，以 SceneTree 脚本方式启动。
## 读一份 JSON 配置：跑哪个场景、按什么时间表输入、盯哪些值、什么时候截图。
## 结果以 GDBOX_ 开头的行打印出来，由 GDBox 解析。

const AGGREGATES := ["count", "min", "max", "mean", "sum", "changed"]
## 坐标离原点超过这个数就当「飞出世界」报一次
const FAR := 1.0e6
## 自动探针每隔多少帧扫一遍
const PROBE_EVERY := 6
## 每种探针最多报几条：飞出世界的子弹再多，也不能把 NaN 的名额占掉
const PROBE_MAX_PER_KIND := 10
## 节点列表缓存：增删节点时作废；进出组不发信号，再按这个间隔兜底刷新
const NODE_CACHE_FRAMES := 30
## changed() 第一次采样没有可比的值，返回它表示这一次不出值
var NO_VALUE := RefCounted.new()

var cfg: Dictionary = {}
var scene: Node = null
var frame := 0
var fps := 60
var total_frames := 180
var events := []
var drags := []
var watches := []
var shots := []
var sample_every := 6
var mouse_pos := Vector2.ZERO
var mouse_mask := 0
## changed() 要和上一次采样比：spec -> {instance_id: 值}
var prev_values := {}
var probed := {}
var probe_counts := {"nan": 0, "far": 0}
var selections := {}
var all_nodes = null
var cache_frame := 0


func _frame_of(seconds: float) -> int:
	return int(round(seconds * fps))


func _button_of(e: Dictionary) -> int:
	match str(e.get("button", "left")):
		"right":
			return MOUSE_BUTTON_RIGHT
		"middle":
			return MOUSE_BUTTON_MIDDLE
	return MOUSE_BUTTON_LEFT


func _initialize() -> void:
	var cfg_path := ""
	for a in OS.get_cmdline_user_args():
		if a.begins_with("--gdbox-config="):
			cfg_path = a.substr("--gdbox-config=".length())
	var text := FileAccess.get_file_as_string(cfg_path)
	var parsed = JSON.parse_string(text)
	if typeof(parsed) != TYPE_DICTIONARY:
		print("GDBOX_FATAL could not read config ", cfg_path)
		quit(1)
		return
	cfg = parsed
	# 回放回归要求同一串输入跑出同一串数值：物理步长固定（配合 --fixed-fps），随机种子可钉
	Engine.physics_jitter_fix = 0.0
	if cfg.has("seed"):
		seed(int(cfg.get("seed", 0)))
		# 游戏自己 new 的 RandomNumberGenerator 管不到：把种子放在 Engine 元数据上，
		# 游戏可以写 `if Engine.has_meta("gdbox_seed"): rng.seed = Engine.get_meta("gdbox_seed")`
		Engine.set_meta("gdbox_seed", int(cfg.get("seed", 0)))
	# 无头模式的窗口只有 64×64：UI 排版、鼠标命中、可见区域都和真窗口不一样。撑到工程分辨率。
	# 开窗（截图）时窗口本来就按工程设置开，不动；旧的回放用例是按 64×64 录的，不给 full_viewport 就照旧
	if cfg.get("full_viewport", false) and DisplayServer.get_name() == "headless":
		root.min_size = Vector2i(
			int(ProjectSettings.get_setting("display/window/size/viewport_width", 1152)),
			int(ProjectSettings.get_setting("display/window/size/viewport_height", 648))
		)
	# 模拟的鼠标移动不合并、不延后，一帧发出去一帧就到
	Input.use_accumulated_input = false
	fps = int(cfg.get("fps", 60))
	total_frames = _frame_of(float(cfg.get("seconds", 3.0)))
	sample_every = max(1, int(round(fps * float(cfg.get("sample_interval", 0.1)))))
	for e in cfg.get("inputs", []):
		var at := float(e.get("at", 0.0))
		var start := _frame_of(at)
		if e.has("drag"):
			var d: Dictionary = e["drag"]
			var end: int = max(start + 1, _frame_of(at + float(e.get("hold", 0.3))))
			drags.append({"start": start, "end": end, "from": d.get("from"), "to": d.get("to"), "button": _button_of(e)})
			continue
		var stop: int = max(start + 1, _frame_of(at + float(e.get("hold", 0.1))))
		if e.has("click"):
			# 按下和松开共用一份状态：按下没发出去（目标找不到），这一次的松开也不发
			var click := {"sent": false}
			events.append({"frame": start, "kind": "mouse", "target": e["click"], "button": _button_of(e), "press": true, "click": click})
			events.append({"frame": stop, "kind": "mouse", "button": _button_of(e), "press": false, "click": click})
		elif e.has("key"):
			var key := str(e["key"])
			events.append({"frame": start, "kind": "key", "key": key, "press": true})
			events.append({"frame": stop, "kind": "key", "key": key, "press": false})
		else:
			var action := str(e.get("action", ""))
			events.append({"frame": start, "kind": "action", "action": action, "press": true})
			events.append({"frame": stop, "kind": "action", "action": action, "press": false})
	for w in cfg.get("watch", []):
		watches.append(str(w))
	for s in cfg.get("screenshots", []):
		shots.append({"frame": _frame_of(float(s.get("at", 0.0))), "path": str(s.get("path", ""))})

	var path := str(cfg.get("scene", ""))
	if path == "":
		path = str(ProjectSettings.get_setting("application/run/main_scene", ""))
	if path.begins_with("uid://"):
		path = ResourceUID.get_id_path(ResourceUID.text_to_id(path))
	var packed = load(path)
	if packed == null:
		print("GDBOX_FATAL cannot load scene ", path)
		quit(1)
		return
	scene = packed.instantiate()
	root.add_child(scene)
	node_added.connect(_invalidate_nodes.unbind(1))
	node_removed.connect(_invalidate_nodes.unbind(1))
	current_scene = scene
	print("GDBOX_START scene=", path, " frames=", total_frames)


# ---------------------------------------------------------------- 取值

func _find_node(node_part: String) -> Node:
	if node_part.begins_with("%"):
		var cls := node_part.substr(1)
		if scene.is_class(cls):
			return scene
		var found := scene.find_children("*", cls, true, false)
		return null if found.is_empty() else found[0]
	return scene.get_node_or_null(NodePath(node_part if node_part != "" else "."))


func _invalidate_nodes() -> void:
	selections.clear()
	all_nodes = null


func _refresh_cache() -> void:
	if frame - cache_frame >= NODE_CACHE_FRAMES:
		cache_frame = frame
		_invalidate_nodes()


## 场景里所有节点（含场景根），探针用
func _all_nodes() -> Array:
	if all_nodes == null:
		all_nodes = scene.find_children("*", "", true, false)
		all_nodes.push_front(scene)
	return all_nodes


func _select(sel: String) -> Array:
	if not selections.has(sel):
		selections[sel] = _select_uncached(sel)
	return selections[sel]


## 一组节点："@group"（组里所有节点）、"%Class"（该类的所有节点）、"Path/*"（Path 的直接子节点）
func _select_uncached(sel: String) -> Array:
	if sel.begins_with("@"):
		return get_nodes_in_group(sel.substr(1))
	if sel.begins_with("%"):
		var cls := sel.substr(1)
		var found: Array = scene.find_children("*", cls, true, false)
		if scene.is_class(cls):
			found.push_front(scene)
		return found
	if sel.ends_with("/*"):
		var parent := scene.get_node_or_null(NodePath(sel.trim_suffix("/*") if sel != "/*" else "."))
		return [] if parent == null else parent.get_children()
	return []


func _read(node: Node, prop: String):
	if prop == "":
		return str(node.get_path())
	# 最后一段可以是不带参数的取值方法："Spawner:get_child_count()"、"Player:is_on_floor()"。
	# 只认 get_/is_/has_ 开头的：watch 是看数，不能顺手调一个会改游戏状态的方法
	if prop.ends_with("()"):
		var dot := prop.rfind(":")
		var method := prop.substr(dot + 1).trim_suffix("()")
		var target = node if dot < 0 else node.get_indexed(NodePath(":" + prop.substr(0, dot)))
		if not (method.begins_with("get_") or method.begins_with("is_") or method.begins_with("has_")):
			return "<only get_/is_/has_ methods>"
		if typeof(target) != TYPE_OBJECT or target == null or not target.has_method(method):
			return "<no method " + method + ">"
		return target.call(method)
	return node.get_indexed(NodePath(":" + prop))


func _split(spec: String) -> Array:
	var colon := spec.find(":")
	return [spec, ""] if colon < 0 else [spec.substr(0, colon), spec.substr(colon + 1)]


func _resolve(spec: String):
	# "Player:position"、".:player:velocity"、"%CharacterBody2D:position"、"max(@balls:position:y)"
	var paren := spec.find("(")
	if paren > 0 and spec.ends_with(")") and AGGREGATES.has(spec.substr(0, paren)):
		return _aggregate(spec, spec.substr(0, paren), spec.substr(paren + 1, spec.length() - paren - 2))
	var parts := _split(spec)
	var node := _find_node(parts[0])
	if node == null:
		return "<no node>"
	return _read(node, parts[1])


## 数值化：向量取长度，布尔取 0/1，其它不算
func _as_number(v):
	match typeof(v):
		TYPE_INT, TYPE_FLOAT:
			return float(v)
		TYPE_BOOL:
			return 1.0 if v else 0.0
		TYPE_VECTOR2, TYPE_VECTOR3, TYPE_VECTOR2I, TYPE_VECTOR3I:
			return v.length()
	return null


func _differs(a, b) -> bool:
	if typeof(a) != typeof(b):
		return true
	match typeof(a):
		TYPE_FLOAT:
			return absf(a - b) > 1e-3
		TYPE_VECTOR2, TYPE_VECTOR3:
			return a.distance_to(b) > 1e-3
	return a != b


func _aggregate(spec: String, fn: String, inner: String):
	var parts := _split(inner)
	var nodes := _select(parts[0])
	if fn == "count":
		return nodes.size()
	if parts[1] == "":
		return "<" + fn + " needs a property>"
	if fn == "changed":
		# 这一次和上一次采样之间，值变了的节点占多少（0–1）。第一次采样没有可比的，不出值
		var before: Dictionary = prev_values.get(spec, {})
		var now := {}
		var moved := 0
		var compared := 0
		for n in nodes:
			var v = _read(n, parts[1])
			now[n.get_instance_id()] = v
			if before.has(n.get_instance_id()):
				compared += 1
				if _differs(before[n.get_instance_id()], v):
					moved += 1
		var first := not prev_values.has(spec)
		prev_values[spec] = now
		if first:
			return NO_VALUE
		return 0.0 if compared == 0 else snapped(moved / float(compared), 0.001)
	var nums := []
	for n in nodes:
		var x = _as_number(_read(n, parts[1]))
		if x != null:
			# NaN 进了 minf/maxf 会被另一个数顶掉：有一个就直接报它
			if not is_finite(x):
				return x
			nums.append(x)
	if nums.is_empty():
		return "<none>"
	var total := 0.0
	var lo: float = nums[0]
	var hi: float = nums[0]
	for x in nums:
		total += x
		lo = minf(lo, x)
		hi = maxf(hi, x)
	match fn:
		"min":
			return lo
		"max":
			return hi
		"sum":
			return total
	return total / nums.size()


func _sample() -> void:
	if watches.is_empty():
		return
	var values := {}
	for w in watches:
		var v = _resolve(w)
		if is_same(v, NO_VALUE):
			continue
		values[w] = var_to_str(v) if typeof(v) != TYPE_STRING else v
	print("GDBOX_WATCH ", JSON.stringify({"t": snapped(frame / float(fps), 0.001), "v": values}))


# ---------------------------------------------------------------- 自动探针

func _report_probe(node: Node, prop: String, value, kind: String) -> void:
	var key := str(node.get_instance_id()) + prop
	if probed.has(key) or probe_counts[kind] >= PROBE_MAX_PER_KIND:
		return
	probed[key] = true
	probe_counts[kind] += 1
	print("GDBOX_PROBE ", JSON.stringify({
		"t": snapped(frame / float(fps), 0.001),
		"kind": kind,
		"node": str(scene.get_path_to(node)),
		"prop": prop,
		"value": var_to_str(value)
	}))


func _check_value(node: Node, prop: String) -> void:
	var v = node.get(prop)
	if (typeof(v) == TYPE_VECTOR2 or typeof(v) == TYPE_VECTOR3) and not v.is_finite():
		_report_probe(node, prop, v, "nan")
	elif prop == "global_position" and v.length() > FAR:
		_report_probe(node, prop, v, "far")


## 不用谁写断言也要抓的：坐标或速度变成 NaN/inf，物体飞出几百万像素外
func _probe() -> void:
	if probe_counts["nan"] >= PROBE_MAX_PER_KIND and probe_counts["far"] >= PROBE_MAX_PER_KIND:
		return
	for n in _all_nodes():
		if not (n is Node2D or n is Node3D) or not n.is_inside_tree():
			continue
		_check_value(n, "global_position")
		if n is CharacterBody2D or n is CharacterBody3D:
			_check_value(n, "velocity")
		elif n is RigidBody2D or n is RigidBody3D:
			_check_value(n, "linear_velocity")


# ---------------------------------------------------------------- 输入

## 点击目标的屏幕坐标：[x, y] 原样用；节点路径取它在屏幕上的位置（Control 取中心）
func _screen_pos(target):
	if typeof(target) == TYPE_ARRAY and target.size() == 2:
		return Vector2(float(target[0]), float(target[1]))
	var node := _find_node(str(target))
	if node == null:
		return null
	var at := Vector2.ZERO
	if node is Control:
		at = node.get_global_transform_with_canvas() * (node.size / 2.0)
	elif node is CanvasItem:
		at = node.get_global_transform_with_canvas().origin
	elif node is Node3D:
		var cam := node.get_viewport().get_camera_3d()
		if cam == null or cam.is_position_behind(node.global_position):
			return null
		at = cam.unproject_position(node.global_position)
	else:
		return null
	return root.get_final_transform() * at


func _mouse_move(pos: Vector2) -> void:
	var m := InputEventMouseMotion.new()
	m.position = pos
	m.global_position = pos
	m.relative = pos - mouse_pos
	m.button_mask = mouse_mask
	mouse_pos = pos
	Input.parse_input_event(m)


func _mouse_button(button: int, pressed: bool) -> void:
	var bit := 1 << (button - 1)
	mouse_mask = (mouse_mask | bit) if pressed else (mouse_mask & ~bit)
	var m := InputEventMouseButton.new()
	m.button_index = button
	m.pressed = pressed
	m.position = mouse_pos
	m.global_position = mouse_pos
	m.button_mask = mouse_mask
	Input.parse_input_event(m)


func _key(name: String, pressed: bool) -> bool:
	var code := OS.find_keycode_from_string(name)
	if code == KEY_NONE:
		return false
	var k := InputEventKey.new()
	k.keycode = code
	k.physical_keycode = code
	k.pressed = pressed
	if pressed and code >= 32 and code < 127:
		k.unicode = name.to_lower().unicode_at(0) if name.length() == 1 else code
	Input.parse_input_event(k)
	return true


func _fire(e: Dictionary) -> void:
	match e["kind"]:
		"action":
			if e["action"] == "":
				return
			if not InputMap.has_action(e["action"]):
				if e["press"]:
					print("GDBOX_WARN unknown input action ", e["action"])
				return
			if e["press"]:
				Input.action_press(e["action"])
			else:
				Input.action_release(e["action"])
		"key":
			if not _key(e["key"], e["press"]) and e["press"]:
				print("GDBOX_WARN unknown key ", e["key"])
		"mouse":
			if e["press"]:
				var pos = _screen_pos(e["target"])
				if pos == null:
					print("GDBOX_WARN click target not found ", e["target"])
					return
				_mouse_move(pos)
				e["click"]["sent"] = true
			elif not e["click"]["sent"]:
				return
			_mouse_button(e["button"], e["press"])


func _drag_step(d: Dictionary) -> void:
	if frame == d["start"]:
		d["a"] = _screen_pos(d["from"])
		d["b"] = _screen_pos(d["to"])
		if d["a"] == null or d["b"] == null:
			print("GDBOX_WARN drag target not found ", d["from"] if d["a"] == null else d["to"])
			d["end"] = -1
			return
		_mouse_move(d["a"])
		_mouse_button(d["button"], true)
	elif frame > d["start"] and frame <= d["end"]:
		_mouse_move(d["a"].lerp(d["b"], (frame - d["start"]) / float(d["end"] - d["start"])))
		if frame == d["end"]:
			_mouse_button(d["button"], false)


func _process(_delta: float) -> bool:
	if scene == null:
		return true
	_refresh_cache()
	for e in events:
		if e["frame"] == frame:
			_fire(e)
	for d in drags:
		_drag_step(d)
	if frame % sample_every == 0:
		_sample()
	if frame % PROBE_EVERY == 0:
		_probe()
	for s in shots:
		if s["frame"] == frame and DisplayServer.get_name() != "headless":
			var img := root.get_texture().get_image()
			if img:
				img.save_png(s["path"])
				print("GDBOX_SHOT ", s["path"])
	frame += 1
	if frame > total_frames:
		_sample()
		_probe()
		# 退出前停掉所有音频，避免 4.7.x 的退出期泄漏报告
		for p in scene.find_children("*", "AudioStreamPlayer", true, false):
			p.stop()
		print("GDBOX_END")
		return true
	return false
