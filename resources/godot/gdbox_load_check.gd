extends SceneTree

## GDBox 的脚本加载检查：把清单里的每个 .gd 都 load 一遍，看能不能编译。
## 跑主场景只会编译场景用到的脚本，没挂上去的脚本写坏了照样报「没错误」。
## 放在 _initialize 里而不是 _init：前者在 autoload 注册之后，引用 autoload 的脚本才不会误报。
## 不用 --check-only 也是这个原因：它不注册 autoload。
## 结果以 GDBOX_ 开头的行打印出来；具体错误由引擎自己打在上面。

func _initialize() -> void:
	var list_path := ""
	for a in OS.get_cmdline_user_args():
		if a.begins_with("--gdbox-list="):
			list_path = a.substr("--gdbox-list=".length())
	var text := FileAccess.get_file_as_string(list_path)
	if text.is_empty():
		print("GDBOX_FATAL could not read script list ", list_path)
		quit(2)
		return
	var checked := 0
	var failed := 0
	for path in text.split("\n", false):
		path = path.strip_edges()
		if path.is_empty():
			continue
		checked += 1
		var script := load(path) as Script
		if script == null or not script.can_instantiate():
			failed += 1
			print("GDBOX_LOADFAIL ", path)
	print("GDBOX_LOADCHECK ", checked, " ", failed)
	quit(1 if failed > 0 else 0)
