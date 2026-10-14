extends SceneTree

## GDBox 的试玩运行器：不改用户工程，以 SceneTree 脚本方式启动。
## 读一份 JSON 配置：跑哪个场景、按什么时间表按键、盯哪些值、什么时候截图。
## 结果以 GDBOX_ 开头的行打印出来，由 GDBox 解析。

var cfg: Dictionary = {}
var scene: Node = null
var frame := 0
var fps := 60
var total_frames := 180
var events := []
var watches := []
var shots := []
var sample_every := 6


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
	fps = int(cfg.get("fps", 60))
	total_frames = int(round(float(cfg.get("seconds", 3.0)) * fps))
	sample_every = max(1, int(round(fps * float(cfg.get("sample_interval", 0.1)))))
	for e in cfg.get("inputs", []):
		events.append({"frame": int(round(float(e.get("at", 0.0)) * fps)), "action": str(e.get("action", "")), "press": true})
		var hold := float(e.get("hold", 0.1))
		events.append({"frame": int(round((float(e.get("at", 0.0)) + hold) * fps)), "action": str(e.get("action", "")), "press": false})
	for w in cfg.get("watch", []):
		watches.append(str(w))
	for s in cfg.get("screenshots", []):
		shots.append({"frame": int(round(float(s.get("at", 0.0)) * fps)), "path": str(s.get("path", ""))})

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
	current_scene = scene
	print("GDBOX_START scene=", path, " frames=", total_frames)


func _resolve(spec: String):
	# "Player:position"、".:player:velocity"、"%CharacterBody2D:position"
	var colon := spec.find(":")
	var node_part := spec if colon < 0 else spec.substr(0, colon)
	var prop := "" if colon < 0 else spec.substr(colon + 1)
	var node: Node = null
	if node_part.begins_with("%"):
		var cls := node_part.substr(1)
		var found := scene.find_children("*", cls, true, false)
		if scene.is_class(cls):
			node = scene
		elif not found.is_empty():
			node = found[0]
	else:
		node = scene.get_node_or_null(NodePath(node_part if node_part != "" else "."))
	if node == null:
		return "<no node>"
	if prop == "":
		return str(node.get_path())
	var value = node.get_indexed(NodePath(":" + prop))
	return value


func _sample() -> void:
	if watches.is_empty():
		return
	var values := {}
	for w in watches:
		var v = _resolve(w)
		values[w] = var_to_str(v) if typeof(v) != TYPE_STRING else v
	print("GDBOX_WATCH ", JSON.stringify({"t": snapped(frame / float(fps), 0.001), "v": values}))


func _process(_delta: float) -> bool:
	if scene == null:
		return true
	for e in events:
		if e["frame"] == frame and e["action"] != "":
			if not InputMap.has_action(e["action"]):
				if e["press"]:
					print("GDBOX_WARN unknown input action ", e["action"])
				continue
			if e["press"]:
				Input.action_press(e["action"])
			else:
				Input.action_release(e["action"])
	if frame % sample_every == 0:
		_sample()
	for s in shots:
		if s["frame"] == frame and DisplayServer.get_name() != "headless":
			var img := root.get_texture().get_image()
			if img:
				img.save_png(s["path"])
				print("GDBOX_SHOT ", s["path"])
	frame += 1
	if frame > total_frames:
		_sample()
		# 退出前停掉所有音频，避免 4.7.x 的退出期泄漏报告
		for p in scene.find_children("*", "AudioStreamPlayer", true, false):
			p.stop()
		print("GDBOX_END")
		return true
	return false
