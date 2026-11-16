@tool
extends EditorImportPlugin

## 把 .css 导入成 Theme。编译警告逐条打到输出面板，带文件名和行号。

const GdCssCompiler := preload("gdcss.gd")


func _get_importer_name() -> String:
	return "gdbox.css_theme"


func _get_visible_name() -> String:
	return "CSS Theme"


func _get_recognized_extensions() -> PackedStringArray:
	return PackedStringArray(["css"])


func _get_save_extension() -> String:
	return "res"


func _get_resource_type() -> String:
	return "Theme"


func _get_priority() -> float:
	return 1.0


## CSS 里会 url() 引用字体和图标，排在普通资源后面导入，第一次导入时它们才已经在了
func _get_import_order() -> int:
	return 100


func _can_import_threaded() -> bool:
	return false


func _get_preset_count() -> int:
	return 1


func _get_preset_name(_preset_index: int) -> String:
	return "Default"


func _get_import_options(_path: String, _preset_index: int) -> Array[Dictionary]:
	return []


func _get_option_visibility(_path: String, _option_name: StringName, _options: Dictionary) -> bool:
	return true


func _import(source_file: String, save_path: String, _options: Dictionary, _platform_variants: Array[String], _gen_files: Array[String]) -> Error:
	var text := FileAccess.get_file_as_string(source_file)
	if text == "" and FileAccess.get_open_error() != OK:
		return FileAccess.get_open_error()
	var compiler := GdCssCompiler.new()
	var theme := compiler.compile(text, source_file.get_base_dir())
	for w in compiler.warnings:
		push_warning("%s:%s" % [source_file, w])
	return ResourceSaver.save(theme, "%s.%s" % [save_path, _get_save_extension()])
