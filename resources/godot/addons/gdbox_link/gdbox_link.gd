@tool
extends EditorPlugin

## GDBox Link：把 Godot 编辑器连到 GDBox。
##
## GDBox 是服务端（本机 17870 端口），插件主动连过去、断了每 3 秒重连。
## 连上先报一次工程信息（project.info），之后每 10 秒一次心跳。
## 只回答 GDBox 的请求，不会自己改工程。
##
## 线上格式和虚幻盒子的 UnrealAgentLink 一致：
##   请求 {ver, type:"req", id, method, params, time}
##   回包 {ver, type:"res", id, code, result, time}，code >= 400 时 result 里带 message
##   事件 {ver, type:"evt", method, payload, time}

const URL := "ws://127.0.0.1:17870"
const VERSION := "1.0"
const HEARTBEAT_SECONDS := 10.0
const RETRY_SECONDS := 3.0
## 一次回给 GDBox 的选中节点 / 文件最多多少个。再多模型也看不过来，还会撑大消息
const MAX_LISTED := 50

var _ws := WebSocketPeer.new()
var _last_state := WebSocketPeer.STATE_CLOSED
var _retry_in := 0.0
var _heartbeat_in := 0.0
var _context_menu: EditorContextMenuPlugin = null


func _enter_tree() -> void:
	_ws.inbound_buffer_size = 4 * 1024 * 1024
	_ws.outbound_buffer_size = 4 * 1024 * 1024
	# 文件系统面板右键「添加到 GDBox 资产库」（4.4 起才有右键菜单扩展点）
	if ClassDB.class_exists("EditorContextMenuPlugin"):
		_context_menu = load(get_script().resource_path.get_base_dir() + "/gdbox_context_menu.gd").new(self)
		add_context_menu_plugin(EditorContextMenuPlugin.CONTEXT_SLOT_FILESYSTEM, _context_menu)
	_open()


func _exit_tree() -> void:
	if _context_menu:
		remove_context_menu_plugin(_context_menu)
		_context_menu = null
	_send_event("project.closed", {"projectPath": _project_path()})
	_ws.close()


func _open() -> void:
	_ws = WebSocketPeer.new()
	_ws.inbound_buffer_size = 4 * 1024 * 1024
	_ws.outbound_buffer_size = 4 * 1024 * 1024
	_ws.connect_to_url(URL)


func _process(delta: float) -> void:
	_ws.poll()
	var state := _ws.get_ready_state()
	if state == WebSocketPeer.STATE_OPEN:
		if _last_state != WebSocketPeer.STATE_OPEN:
			_send_event("project.info", _project_info())
			_heartbeat_in = HEARTBEAT_SECONDS
		_heartbeat_in -= delta
		if _heartbeat_in <= 0.0:
			_heartbeat_in = HEARTBEAT_SECONDS
			_send_event("system.heartbeat", {})
		while _ws.get_available_packet_count() > 0:
			_handle(_ws.get_packet().get_string_from_utf8())
	elif state == WebSocketPeer.STATE_CLOSED:
		_retry_in -= delta
		if _retry_in <= 0.0:
			_retry_in = RETRY_SECONDS
			_open()
	_last_state = state


func _now() -> int:
	return int(Time.get_unix_time_from_system() * 1000.0)


func _send(data: Dictionary) -> void:
	if _ws.get_ready_state() == WebSocketPeer.STATE_OPEN:
		_ws.send_text(JSON.stringify(data))


func _send_event(method: String, payload: Dictionary) -> void:
	_send({"ver": VERSION, "type": "evt", "method": method, "payload": payload, "time": _now()})


func _reply(id: String, code: int, result) -> void:
	_send({"ver": VERSION, "type": "res", "id": id, "code": code, "result": result, "time": _now()})


## 文件系统面板右键菜单调它
func add_paths_to_library(res_paths: PackedStringArray) -> void:
	var real_paths := []
	for p in res_paths:
		real_paths.append(ProjectSettings.globalize_path(p))
	_send_event("content.import_folder", {
		"paths": Array(res_paths),
		"real_paths": real_paths,
		"engine_version": _godot_version(),
		"project_name": _project_name(),
	})


func _project_path() -> String:
	return ProjectSettings.globalize_path("res://").trim_suffix("/")


func _project_name() -> String:
	return str(ProjectSettings.get_setting("application/config/name", ""))


func _godot_version() -> String:
	var v := Engine.get_version_info()
	return "%d.%d.%d" % [v.major, v.minor, v.patch]


func _project_info() -> Dictionary:
	var plugins := []
	for p in ProjectSettings.get_setting("editor_plugins/enabled", PackedStringArray()):
		plugins.append(str(p))
	return {
		"projectName": _project_name(),
		"projectVersion": str(ProjectSettings.get_setting("application/config/version", "")),
		"engineVersion": _godot_version(),
		"projectPath": _project_path(),
		"defaultMap": str(ProjectSettings.get_setting("application/run/main_scene", "")),
		"enabledPluginNames": plugins,
		"interactive": DisplayServer.get_name() != "headless",
		"runMode": "editor",
	}


func _handle(text: String) -> void:
	var msg = JSON.parse_string(text)
	if typeof(msg) != TYPE_DICTIONARY or str(msg.get("type", "")) != "req" or not msg.has("id"):
		return
	var id := str(msg["id"])
	var params: Dictionary = msg.get("params", {}) if typeof(msg.get("params")) == TYPE_DICTIONARY else {}
	var method := str(msg.get("method", ""))
	var outcome := _dispatch(method, params)
	if outcome.has("error"):
		_reply(id, int(outcome.get("code", 400)), {"message": outcome["error"]})
	else:
		_reply(id, 200, outcome.get("result"))


func _dispatch(method: String, params: Dictionary) -> Dictionary:
	match method:
		"system.get_project_info":
			return {"result": _project_info()}
		"editor.get_focus_context":
			return {"result": _focus_context()}
		"editor.status":
			return {"result": _status()}
		"editor.selection":
			return {"result": _selection()}
		"editor.scene_tree":
			return {"result": _scene_tree(int(params.get("max_depth", 8)))}
		"editor.open_asset":
			return _open_asset(str(params.get("path", "")))
		"editor.open_scene":
			var path := str(params.get("path", ""))
			if not ResourceLoader.exists(path):
				return {"code": 404, "error": "No such scene: " + path}
			EditorInterface.open_scene_from_path(path)
			return {"result": {"ok": true}}
		"editor.reload_scene":
			var path := str(params.get("path", ""))
			if path in EditorInterface.get_open_scenes():
				EditorInterface.reload_scene_from_path(path)
				return {"result": {"ok": true, "reloaded": true}}
			return {"result": {"ok": true, "reloaded": false}}
		"editor.select":
			return {"result": {"ok": true, "selected": _select(params.get("paths", []))}}
		"editor.rescan":
			EditorInterface.get_resource_filesystem().scan()
			return {"result": {"ok": true}}
		"editor.save_all":
			EditorInterface.save_all_scenes()
			return {"result": {"ok": true}}
		"editor.play":
			var scene := str(params.get("scene", ""))
			if scene == "":
				EditorInterface.play_main_scene()
			else:
				EditorInterface.play_custom_scene(scene)
			return {"result": {"ok": true}}
		"editor.stop":
			EditorInterface.stop_playing_scene()
			return {"result": {"ok": true}}
		_:
			return {"code": 404, "error": "Unknown method: " + method}


func _open_asset(path: String) -> Dictionary:
	if not ResourceLoader.exists(path) and not FileAccess.file_exists(path):
		return {"result": {"ok": true, "missing": true}}
	var already := path in EditorInterface.get_open_scenes()
	if path.get_extension() in ["tscn", "scn"]:
		EditorInterface.open_scene_from_path(path)
	elif ResourceLoader.exists(path):
		EditorInterface.edit_resource(load(path))
	# 在文件系统面板里也选中它，让用户知道它放在哪
	EditorInterface.select_file(path)
	return {"result": {"ok": true, "opened": not already}}


func _status() -> Dictionary:
	var root := EditorInterface.get_edited_scene_root()
	return {
		"edited_scene": root.scene_file_path if root else "",
		"open_scenes": Array(EditorInterface.get_open_scenes()),
		"playing": EditorInterface.is_playing_scene(),
	}


func _describe(node: Node, root: Node) -> Dictionary:
	var info := {
		"path": str(root.get_path_to(node)) if root else str(node.name),
		"name": str(node.name),
		"type": node.get_class(),
	}
	var script := node.get_script() as Script
	if script and script.resource_path != "":
		info["script"] = script.resource_path
	if node.scene_file_path != "" and node != root:
		info["instance"] = node.scene_file_path
	if node is Node2D:
		info["position"] = str((node as Node2D).position)
	elif node is Node3D:
		info["position"] = str((node as Node3D).position)
	elif node is Control:
		info["position"] = str((node as Control).position)
	return info


func _selection() -> Dictionary:
	var root := EditorInterface.get_edited_scene_root()
	var nodes := []
	for node in EditorInterface.get_selection().get_selected_nodes():
		if nodes.size() >= MAX_LISTED:
			break
		nodes.append(_describe(node, root))
	return {"scene": root.scene_file_path if root else "", "nodes": nodes}


## 用户按下发送那一刻的编辑器状态（盒子叫它「闪存」）。
func _focus_context() -> Dictionary:
	var root := EditorInterface.get_edited_scene_root()
	var open_scenes := []
	for p in EditorInterface.get_open_scenes():
		open_scenes.append({"name": str(p).get_file().get_basename(), "path": str(p)})
	var context := {"openScenes": open_scenes}
	if root:
		context["editedScene"] = {"name": str(root.name), "path": root.scene_file_path}

	var selected := EditorInterface.get_selection().get_selected_nodes()
	var nodes := []
	for node in selected:
		if nodes.size() >= MAX_LISTED:
			break
		var path := str(root.get_path_to(node)) if root else str(node.name)
		nodes.append({"name": str(node.name), "class": node.get_class(), "path": path})
	context["selectedNodes"] = nodes
	context["selectedNodeCount"] = selected.size()
	context["selectedNodesTruncated"] = selected.size() > nodes.size()

	var files := []
	var folders := []
	var picked := EditorInterface.get_selected_paths()
	for p in picked:
		var path := str(p)
		if path.ends_with("/"):
			folders.append(path)
		elif files.size() < MAX_LISTED:
			files.append({"name": path.get_file(), "path": path, "class": EditorInterface.get_resource_filesystem().get_file_type(path)})
	context["fileSystem"] = {
		"selectedFiles": files,
		"selectedFileCount": picked.size() - folders.size(),
		"selectedFilesTruncated": picked.size() - folders.size() > files.size(),
		"selectedFolders": folders,
	}
	return context


func _select(paths) -> Array:
	var root := EditorInterface.get_edited_scene_root()
	var selection := EditorInterface.get_selection()
	selection.clear()
	var picked := []
	if root == null or typeof(paths) != TYPE_ARRAY:
		return picked
	for p in paths:
		var node := root if str(p) == "." else root.get_node_or_null(NodePath(str(p)))
		if node:
			selection.add_node(node)
			picked.append(str(p))
	if picked.size() == 1:
		EditorInterface.edit_node(root if picked[0] == "." else root.get_node(NodePath(picked[0])))
	return picked


func _scene_tree(max_depth: int) -> Dictionary:
	var root := EditorInterface.get_edited_scene_root()
	if root == null:
		return {"scene": "", "tree": null}
	return {"scene": root.scene_file_path, "tree": _walk(root, root, 0, max_depth)}


func _walk(node: Node, root: Node, depth: int, max_depth: int) -> Dictionary:
	var info := _describe(node, root)
	var children := []
	if depth < max_depth:
		for child in node.get_children():
			# 实例化的子场景内部不展开，只列这一层
			if child.owner == root or child.owner == null and node == root:
				children.append(_walk(child, root, depth + 1, max_depth))
	elif node.get_child_count() > 0:
		info["more_children"] = node.get_child_count()
	if not children.is_empty():
		info["children"] = children
	return info
