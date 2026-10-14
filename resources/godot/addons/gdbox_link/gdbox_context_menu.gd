@tool
extends EditorContextMenuPlugin

## 文件系统面板右键「添加到 GDBox 资产库」。选中的文件和文件夹交给 GDBox 导进资产库。

var _link


func _init(link) -> void:
	_link = link


func _popup_menu(paths: PackedStringArray) -> void:
	if paths.is_empty():
		return
	add_context_menu_item("添加到 GDBox 资产库", _add)


func _add(paths: PackedStringArray) -> void:
	_link.add_paths_to_library(paths)
