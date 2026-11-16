@tool
extends EditorContextMenuPlugin

## 文件系统面板右键「添加到 GDBox 资产库」。选中的文件和文件夹交给 GDBox 导进资产库。
##
## 4.8 起用 _get_menu_options，回调拿到 {&"selected_files": PackedStringArray}；
## 4.4–4.7 只有 _popup_menu，回调拿到路径数组。4.8 两个都会调，
## 所以 _popup_menu 在 4.8 上什么都不做，否则同名菜单项会注册两次。

const LABEL := "添加到 GDBox 资产库"
const NEW_API_HEX := 0x040800

var _link


func _init(link) -> void:
	_link = link


func _get_menu_options(data) -> void:
	if not (data.get(&"selected_files", PackedStringArray()) as PackedStringArray).is_empty():
		add_context_menu_item(LABEL, _add)


func _popup_menu(paths: PackedStringArray) -> void:
	if Engine.get_version_info().hex >= NEW_API_HEX or paths.is_empty():
		return
	add_context_menu_item(LABEL, _add)


func _add(data) -> void:
	var paths: PackedStringArray = data.get(&"selected_files", PackedStringArray()) if data is Dictionary else data
	_link.add_paths_to_library(paths)
