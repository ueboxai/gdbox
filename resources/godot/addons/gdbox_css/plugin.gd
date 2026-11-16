@tool
extends EditorPlugin

## GDBox CSS：让 .css 文件在 Godot 里直接当 Theme 用。
##
## 启用后 res:// 下的 .css 会被导入成 Theme 资源，拖到 Control 的 theme 属性上，
## 或者填进 项目设置 → GUI → 主题 → 自定义。改了 CSS 切回编辑器就会重新导入。

var _importer: EditorImportPlugin = null


func _enter_tree() -> void:
	_importer = preload("css_import_plugin.gd").new()
	add_import_plugin(_importer)


func _exit_tree() -> void:
	remove_import_plugin(_importer)
	_importer = null
