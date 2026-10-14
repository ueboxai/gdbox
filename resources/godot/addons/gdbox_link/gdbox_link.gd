@tool
extends EditorPlugin

## GDBox Link：把 Godot 编辑器连到 GDBox。
## GDBox 是服务端（本机 17870 端口），插件主动连过去、断了每 3 秒重连。
## 只回答 GDBox 的请求，并在选中变化时通知一声；不会自己改工程。

const URL := "ws://127.0.0.1:17870"
const PROTOCOL := 1

var _ws := WebSocketPeer.new()
var _last_state := WebSocketPeer.STATE_CLOSED
var _retry_in := 0.0


func _enter_tree() -> void:
	EditorInterface.get_selection().selection_changed.connect(_on_selection_changed)
	scene_changed.connect(_on_scene_changed)
	_open()


func _exit_tree() -> void:
	var selection := EditorInterface.get_selection()
	if selection.selection_changed.is_connected(_on_selection_changed):
		selection.selection_changed.disconnect(_on_selection_changed)
	if scene_changed.is_connected(_on_scene_changed):
		scene_changed.disconnect(_on_scene_changed)
	_ws.close()


func _open() -> void:
	_ws = WebSocketPeer.new()
	_ws.connect_to_url(URL)


func _process(delta: float) -> void:
	_ws.poll()
	var state := _ws.get_ready_state()
	if state == WebSocketPeer.STATE_OPEN:
		if _last_state != WebSocketPeer.STATE_OPEN:
			_send({
				"type": "hello",
				"protocol": PROTOCOL,
				"project": ProjectSettings.globalize_path("res://"),
				"name": str(ProjectSettings.get_setting("application/config/name", "")),
				"godot": Engine.get_version_info().string,
			})
		while _ws.get_available_packet_count() > 0:
			_handle(_ws.get_packet().get_string_from_utf8())
	elif state == WebSocketPeer.STATE_CLOSED:
		_retry_in -= delta
		if _retry_in <= 0.0:
			_retry_in = 3.0
			_open()
	_last_state = state


func _send(data: Dictionary) -> void:
	if _ws.get_ready_state() == WebSocketPeer.STATE_OPEN:
		_ws.send_text(JSON.stringify(data))


func _on_selection_changed() -> void:
	_send({"type": "event", "name": "selection", "data": _selection()})


func _on_scene_changed(_root: Node) -> void:
	_send({"type": "event", "name": "scene", "data": _status()})


func _handle(text: String) -> void:
	var msg = JSON.parse_string(text)
	if typeof(msg) != TYPE_DICTIONARY or not msg.has("id"):
		return
	var params: Dictionary = msg.get("params", {}) if typeof(msg.get("params")) == TYPE_DICTIONARY else {}
	var result = null
	var error := ""
	match str(msg.get("method", "")):
		"status":
			result = _status()
		"selection":
			result = _selection()
		"scene_tree":
			result = _scene_tree(int(params.get("max_depth", 8)))
		"open_scene":
			var path := str(params.get("path", ""))
			if ResourceLoader.exists(path):
				EditorInterface.open_scene_from_path(path)
				result = true
			else:
				error = "No such scene: " + path
		"reload_scene":
			var path := str(params.get("path", ""))
			if path in EditorInterface.get_open_scenes():
				EditorInterface.reload_scene_from_path(path)
				result = true
			else:
				result = false
		"select":
			var root := EditorInterface.get_edited_scene_root()
			var selection := EditorInterface.get_selection()
			selection.clear()
			var picked := []
			if root:
				for p in params.get("paths", []):
					var node := root if str(p) == "." else root.get_node_or_null(NodePath(str(p)))
					if node:
						selection.add_node(node)
						picked.append(str(p))
				if picked.size() == 1:
					EditorInterface.edit_node(root if picked[0] == "." else root.get_node(NodePath(picked[0])))
			result = picked
		"rescan":
			EditorInterface.get_resource_filesystem().scan()
			result = true
		"save_all":
			EditorInterface.save_all_scenes()
			result = true
		"play":
			var scene := str(params.get("scene", ""))
			if scene == "":
				EditorInterface.play_main_scene()
			else:
				EditorInterface.play_custom_scene(scene)
			result = true
		"stop":
			EditorInterface.stop_playing_scene()
			result = true
		_:
			error = "Unknown method: " + str(msg.get("method", ""))
	_send({"id": msg["id"], "ok": error == "", "result": result, "error": error})


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
		nodes.append(_describe(node, root))
	return {"scene": root.scene_file_path if root else "", "nodes": nodes}


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
