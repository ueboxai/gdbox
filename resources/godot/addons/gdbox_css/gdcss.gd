@tool
class_name GdCss
extends RefCounted

## 把一份 CSS 编译成 Godot 的 Theme。
##
## 编辑器里用不到这个类：装上插件后 .css 文件会被直接导入成 Theme 资源，
## `load("res://ui.css")` 拿到的就是 Theme。运行期想从 user:// 或模组里读 CSS
## 再换皮肤时才需要它：`GdCss.load_theme("user://skin.css")`。
##
## 选择器只认 Theme 表达得了的那一部分：
##   Button              类型
##   Button.primary      类型变体（节点的 theme_type_variation 填 primary）
##   .card               不带基类的变体
##   Button:hover        状态（hover / active / pressed / checked / disabled / focus / read-only）
##   ProgressBar::fill   直接指定某个 stylebox
##   :root / *           变量（--x）和全局字体、字号
## 后代、子代、#id、属性选择器 Theme 做不到，会给出警告并跳过。
##
## 层叠规则照 CSS：!important > 特异性 > 书写顺序。Button:hover 继承 Button 的全部声明，
## Button.primary 继承 Button 的全部声明 —— 和浏览器里一个元素同时命中几条规则的结果一致。
## 唯一的例外是 :focus：Godot 的 focus stylebox 是盖在上面画的一层，所以它只继承圆角，
## 不继承背景和边框，否则一获得焦点就把 hover / pressed 的样子整个盖掉。

## 编译过程中发现的问题，一条一行，带行号
var warnings := PackedStringArray()

const ROOT_FONT_SIZE := 16.0

const BUTTON_BOXES := ["normal", "hover", "pressed", "hover_pressed", "disabled", "focus"]
const BUTTON_COLORS := {
	"normal": "font_color",
	"hover": "font_hover_color",
	"pressed": "font_pressed_color",
	"hover_pressed": "font_hover_pressed_color",
	"disabled": "font_disabled_color",
	"focus": "font_focus_color",
}
const LINE_EDIT_COLORS := {"normal": "font_color", "read_only": "font_uneditable_color"}
const TEXT_EDIT_COLORS := {"normal": "font_color", "read_only": "font_readonly_color"}

## 每个控件类型有哪些 stylebox、各状态的字色叫什么、gap 和 padding 落到哪
const PROFILES := {
	"Button": {"boxes": BUTTON_BOXES, "colors": BUTTON_COLORS, "gap": "button"},
	"CheckBox": {"boxes": BUTTON_BOXES, "colors": BUTTON_COLORS, "gap": "button"},
	"CheckButton": {"boxes": BUTTON_BOXES, "colors": BUTTON_COLORS, "gap": "button"},
	"OptionButton": {"boxes": BUTTON_BOXES, "colors": BUTTON_COLORS, "gap": "button"},
	"MenuButton": {"boxes": BUTTON_BOXES, "colors": BUTTON_COLORS, "gap": "button"},
	"ColorPickerButton": {"boxes": BUTTON_BOXES, "colors": BUTTON_COLORS, "gap": "button"},
	"LinkButton": {"boxes": ["focus"], "colors": BUTTON_COLORS},
	"Label": {"boxes": ["normal"], "colors": {"normal": "font_color"}},
	"TooltipLabel": {"boxes": [], "colors": {"normal": "font_color"}},
	"RichTextLabel": {
		"boxes": ["normal", "focus"],
		"colors": {"normal": "default_color"},
		"font": "normal_font",
		"font_size": "normal_font_size",
	},
	"LineEdit": {"boxes": ["normal", "focus", "read_only"], "colors": LINE_EDIT_COLORS},
	"TextEdit": {"boxes": ["normal", "focus", "read_only"], "colors": TEXT_EDIT_COLORS},
	"CodeEdit": {"boxes": ["normal", "focus", "read_only"], "colors": TEXT_EDIT_COLORS},
	"SpinBox": {"boxes": [], "colors": {}},
	"Panel": {"boxes": ["panel"], "colors": {}},
	"PanelContainer": {"boxes": ["panel"], "colors": {}},
	"PopupPanel": {"boxes": ["panel"], "colors": {}},
	"PopupMenu": {"boxes": ["panel"], "colors": {"normal": "font_color", "hover": "font_hover_color", "disabled": "font_disabled_color"}},
	"TooltipPanel": {"boxes": ["panel"], "colors": {}},
	"AcceptDialog": {"boxes": ["panel"], "colors": {}},
	"TabContainer": {"boxes": ["panel"], "colors": {}},
	"ScrollContainer": {"boxes": ["panel"], "colors": {}},
	"Tree": {"boxes": ["panel", "focus"], "colors": {"normal": "font_color"}},
	"ItemList": {"boxes": ["panel", "focus"], "colors": {"normal": "font_color"}},
	"ProgressBar": {"boxes": ["background"], "colors": {"normal": "font_color"}},
	"BoxContainer": {"boxes": [], "colors": {}, "gap": "separation"},
	"HBoxContainer": {"boxes": [], "colors": {}, "gap": "separation"},
	"VBoxContainer": {"boxes": [], "colors": {}, "gap": "separation"},
	"HSplitContainer": {"boxes": [], "colors": {}, "gap": "separation"},
	"VSplitContainer": {"boxes": [], "colors": {}, "gap": "separation"},
	"GridContainer": {"boxes": [], "colors": {}, "gap": "grid"},
	"FlowContainer": {"boxes": [], "colors": {}, "gap": "grid"},
	"HFlowContainer": {"boxes": [], "colors": {}, "gap": "grid"},
	"VFlowContainer": {"boxes": [], "colors": {}, "gap": "grid"},
	"MarginContainer": {"boxes": [], "colors": {}, "padding": "margins"},
	"HSlider": {"boxes": ["slider"], "colors": {}},
	"VSlider": {"boxes": ["slider"], "colors": {}},
	# 滚动条获得焦点时整块换成 scroll_focus，不是叠一层，所以它和 hover 一样继承基础样式
	"HScrollBar": {"boxes": ["scroll", "scroll_focus"], "colors": {}, "aliases": {"focus": "scroll_focus"}},
	"VScrollBar": {"boxes": ["scroll", "scroll_focus"], "colors": {}, "aliases": {"focus": "scroll_focus"}},
}
## 没登记的类型：当成有一个 panel 的容器
const DEFAULT_PROFILE := {"boxes": ["panel"], "colors": {"normal": "font_color"}}
## 只有类名、不知道基类的变体（.card）：panel 和 normal 都写，用到了哪些状态再加哪些
const BARE_PROFILE := {"boxes": ["panel", "normal"], "colors": BUTTON_COLORS}

const PSEUDO_STATES := {
	"hover": "hover",
	"active": "pressed",
	"pressed": "pressed",
	"checked": "pressed",
	"disabled": "disabled",
	"focus": "focus",
	"focus-visible": "focus",
	"read-only": "read_only",
}
## 画某个 stylebox 时，哪些状态的规则算命中。hover_pressed 同时命中 :hover 和 :active，
## 和浏览器里按住一个悬停中的按钮一样
const STATE_MATCH := {
	"hover": ["", "hover"],
	"pressed": ["", "pressed"],
	"hover_pressed": ["", "hover", "pressed", "hover_pressed"],
	"disabled": ["", "disabled"],
	"focus": ["", "focus"],
	"read_only": ["", "read_only"],
	"scroll_focus": ["", "focus"],
}
## Godot 的颜色名是 X11 那一套，这几个和 CSS 同名不同色（CSS 的 gray 是 #808080，X11 是 #bebebe）
const CSS_ONLY_NAMES := {
	"gray": "web_gray",
	"green": "web_green",
	"maroon": "web_maroon",
	"purple": "web_purple",
	"navy": "navy_blue",
}
const FOCUS_INHERITED := ["b.r_tl", "b.r_tr", "b.r_br", "b.r_bl", "b.ol_w", "b.ol_color", "b.ol_off"]
const SIDES := ["t", "r", "b", "l"]
const CORNERS := ["tl", "tr", "br", "bl"]

var _base_dir := "res://"
var _rules: Array = []
var _root_entries: Array = []
var _vars := {}
var _order := 0
## 有的控件没有「某状态的 stylebox」，Godot 在那个状态下画的是另一个部件。
## 滑块没有 focus / hover stylebox：悬停或获得焦点时，已填充的那段换成 grabber_area_highlight。
## 所以 HSlider:focus 写进 grabber_area_highlight，当 ::grabber-area-highlight 处理
const STATE_REDIRECT := {
	"HSlider": {"hover": "grabber_area_highlight", "focus": "grabber_area_highlight"},
	"VSlider": {"hover": "grabber_area_highlight", "focus": "grabber_area_highlight"},
}
## 这些 ::stylebox 先继承另一个 ::stylebox 的声明：高亮的那段默认长得和普通那段一样
const PART_INHERIT := {"grabber_area_highlight": ["grabber_area", "grabber_area_highlight"]}

var _stylebox_names_cache := {}
var _selector_re := RegEx.create_from_string(
	"^(\\*|[A-Za-z_][A-Za-z0-9_]*)?(?:\\.([A-Za-z_][A-Za-z0-9_-]*))?((?::[a-z-]+)*)(?:::([A-Za-z_][A-Za-z0-9_-]*))?$"
)


## 读一个 CSS 文件并编译。警告打到输出面板
static func load_theme(path: String) -> Theme:
	var text := FileAccess.get_file_as_string(path)
	if text == "" and FileAccess.get_open_error() != OK:
		push_error("GdCss：读不到 %s" % path)
		return null
	var compiler := GdCss.new()
	var theme := compiler.compile(text, path.get_base_dir())
	for w in compiler.warnings:
		push_warning("%s:%s" % [path, w])
	return theme


## 编译一段 CSS。base_dir 用来解析 url() 里的相对路径
func compile(source: String, base_dir := "res://") -> Theme:
	_base_dir = base_dir
	_rules.clear()
	_root_entries.clear()
	_vars.clear()
	warnings.clear()
	_order = 0
	_parse(_strip_comments(source))
	_expand_all()
	return _build()


# ---------------------------------------------------------------- 词法与语法


func _warn(line: int, msg: String) -> void:
	warnings.append("%d: %s" % [line, msg])


func _strip_comments(src: String) -> String:
	var parts := PackedStringArray()
	var n := src.length()
	var i := 0
	var start := 0
	var quote := ""
	while i < n:
		var ch := src[i]
		if quote != "":
			if ch == "\\":
				i += 2
				continue
			if ch == quote:
				quote = ""
		elif ch == "\"" or ch == "'":
			quote = ch
		elif ch == "/" and i + 1 < n and src[i + 1] == "*":
			parts.append(src.substr(start, i - start))
			var end := src.find("*/", i + 2)
			end = n if end == -1 else end + 2
			# 注释里的换行留着，行号才对得上
			parts.append("\n".repeat(src.substr(i, end - i).count("\n")))
			i = end
			start = i
			continue
		i += 1
	parts.append(src.substr(start))
	return "".join(parts)


## 从 from 开始找第一个不在引号、括号里的 what，找不到返回 -1
func _find_top(src: String, what: String, from: int) -> int:
	var depth := 0
	var quote := ""
	var i := from
	while i < src.length():
		var ch := src[i]
		if quote != "":
			if ch == "\\":
				i += 1
			elif ch == quote:
				quote = ""
		elif ch == "\"" or ch == "'":
			quote = ch
		elif ch == "(":
			depth += 1
		elif ch == ")":
			depth = maxi(0, depth - 1)
		elif depth == 0 and what.contains(ch):
			return i
		i += 1
	return -1


## open 处是 '{'，返回与之配对的 '}'
func _block_end(src: String, open: int) -> int:
	var depth := 0
	var i := open
	while i < src.length():
		i = _find_top(src, "{}", i)
		if i == -1:
			return -1
		depth += 1 if src[i] == "{" else -1
		if depth == 0:
			return i
		i += 1
	return -1


func _parse(src: String) -> void:
	var i := 0
	while i < src.length():
		var open := _find_top(src, "{;", i)
		var head := src.substr(i, (src.length() if open == -1 else open) - i).strip_edges()
		var line := _line_at(src, i) + _leading_newlines(src, i)
		if open == -1:
			if head != "":
				_warn(line, "结尾有一段没闭合的内容，已忽略：%s" % head.left(40))
			return
		if src[open] == ";":
			if head != "":
				_warn(line, "不支持 %s，已忽略" % head.left(40))
			i = open + 1
			continue
		var close := _block_end(src, open)
		if close == -1:
			_warn(line, "'{' 没有配对的 '}'，后面的内容都忽略了")
			return
		if head.begins_with("@"):
			_warn(line, "不支持 %s 规则，已忽略" % head.get_slice(" ", 0))
		elif _find_top(src.substr(open + 1, close - open - 1), "{", 0) != -1:
			_warn(line, "不支持嵌套规则，整块忽略：%s" % head.left(40))
		else:
			_add_rule(head, src.substr(open + 1, close - open - 1), line)
		i = close + 1


## i 处在第几行（从 1 数）。String.count 的 to 传 0 表示数到末尾，所以 i == 0 单独处理
func _line_at(src: String, i: int) -> int:
	return 1 + (src.count("\n", 0, i) if i > 0 else 0)


func _leading_newlines(src: String, i: int) -> int:
	var count := 0
	while i < src.length() and src[i] in [" ", "\t", "\n", "\r"]:
		if src[i] == "\n":
			count += 1
		i += 1
	return count


func _add_rule(selector_text: String, body: String, line: int) -> void:
	var decls := _parse_declarations(body, line)
	for raw in selector_text.split(","):
		var sel := raw.strip_edges()
		if sel == ":root" or sel == "*" or sel == "html":
			_root_entries.append_array(decls)
			continue
		var m := _selector_re.search(sel)
		if m == null:
			_warn(line, "选择器 `%s` 不支持（Theme 只认 类型 / .变体 / :状态 / ::stylebox），已跳过" % sel)
			continue
		var element := m.get_string(1)
		if element == "*":
			element = ""
		var cls := m.get_string(2).replace("-", "_")
		var state := ""
		var pseudo := m.get_string(3)
		var pseudo_count := 0
		var ok := true
		for p in pseudo.split(":", false):
			pseudo_count += 1
			if not PSEUDO_STATES.has(p):
				_warn(line, "伪类 :%s 不支持，`%s` 已跳过" % [p, sel])
				ok = false
				break
			var s: String = PSEUDO_STATES[p]
			if state == "" or state == s:
				state = s
			elif [state, s].has("hover") and [state, s].has("pressed"):
				state = "hover_pressed"
			else:
				_warn(line, "`%s` 的状态组合 Godot 画不出来，已跳过" % sel)
				ok = false
				break
		if not ok:
			continue
		var part := m.get_string(4).replace("-", "_")
		if part == "" and STATE_REDIRECT.get(element, {}).has(state):
			part = STATE_REDIRECT[element][state]
			state = ""
		if part != "" and state != "":
			_warn(line, "`%s`：::stylebox 名本身就带状态（如 ::tab-hovered），不要再加伪类，已跳过" % sel)
			continue
		if element == "" and cls == "":
			_warn(line, "`%s` 没有类型也没有类名，已跳过" % sel)
			continue
		var spec := (1 if element != "" else 0) + (10 if cls != "" else 0) + 10 * pseudo_count + (1 if part != "" else 0)
		_rules.append({
			"element": element, "cls": cls, "state": state, "part": part,
			"spec": spec, "line": line, "decls": decls, "entries": [],
		})


func _parse_declarations(body: String, line: int) -> Array:
	var out := []
	var i := 0
	while i < body.length():
		var end := _find_top(body, ";", i)
		if end == -1:
			end = body.length()
		var text := body.substr(i, end - i)
		var decl_line := line + _line_at(body, i) - 1 + _leading_newlines(body, i)
		i = end + 1
		text = text.strip_edges()
		if text == "":
			continue
		var colon := text.find(":")
		if colon <= 0:
			_warn(decl_line, "看不懂的声明：%s" % text.left(40))
			continue
		var name := text.left(colon).strip_edges()
		if not name.begins_with("--"):
			name = name.to_lower()
		var value := text.substr(colon + 1).strip_edges()
		var important := false
		if value.to_lower().ends_with("!important"):
			important = true
			value = value.left(value.length() - 10).strip_edges()
		out.append({"name": name, "value": value, "imp": important, "line": decl_line})
	return out


# ---------------------------------------------------------------- 展开声明


func _expand_all() -> void:
	for d in _root_entries:
		if d.name.begins_with("--"):
			_vars[d.name] = d.value
	for r in _rules:
		for d in r.decls:
			_order += 1
			if d.name.begins_with("--"):
				_warn(d.line, "自定义属性 %s 只在 :root 里生效" % d.name)
				continue
			var value := _resolve_vars(d.value, d.line)
			if value == "":
				continue
			for kv in _expand(d.name, value, d.line):
				r.entries.append({"k": kv[0], "v": kv[1], "imp": d.imp, "order": _order})


func _resolve_vars(value: String, line: int) -> String:
	for _guard in 32:
		var at := value.find("var(")
		if at == -1:
			return value
		var close := _matching_paren(value, at + 3)
		if close == -1:
			_warn(line, "var( 没有闭合")
			return ""
		var inner := value.substr(at + 4, close - at - 4)
		var comma := _find_top(inner, ",", 0)
		var name := (inner if comma == -1 else inner.left(comma)).strip_edges()
		var replacement := ""
		if _vars.has(name):
			replacement = _vars[name]
		elif comma != -1:
			replacement = inner.substr(comma + 1).strip_edges()
		else:
			_warn(line, "变量 %s 没有定义" % name)
			return ""
		value = value.left(at) + replacement + value.substr(close + 1)
	_warn(line, "var() 嵌套太深（是不是循环引用了？）")
	return ""


func _matching_paren(s: String, open: int) -> int:
	var depth := 0
	for i in range(open, s.length()):
		if s[i] == "(":
			depth += 1
		elif s[i] == ")":
			depth -= 1
			if depth == 0:
				return i
	return -1


## 把一条 CSS 声明拆成若干 [键, 值]。b.* 进 stylebox，t.* 是文字和常量，r.* 是原样写进 Theme 的条目
func _expand(name: String, value: String, line: int) -> Array:
	var v := value.to_lower()
	var tokens := _split_ws(value)
	match name:
		"background", "background-color":
			if v == "none":
				return [["b.bg_none", true]]
			for t in tokens:
				var c = _color(t)
				if c != null:
					return [["b.bg", c], ["b.bg_none", false]]
			_warn(line, "%s 只支持纯色（渐变和图片 StyleBoxFlat 画不了）：%s" % [name, value])
			return []
		"border", "border-top", "border-right", "border-bottom", "border-left":
			var sides: Array = SIDES if name == "border" else [name.substr(7, 1)]
			var out := []
			var width = 1.0 if tokens.size() > 0 else null
			for t in tokens:
				var tl := t.to_lower()
				if tl == "none" or tl == "hidden":
					width = 0.0
				elif _len(t) != null:
					width = _len(t)
				elif _color(t) != null:
					out.append(["b.bc", _color(t)])
				elif not tl in ["solid", "dashed", "dotted", "double", "groove", "ridge", "inset", "outset"]:
					_warn(line, "%s 里的 %s 看不懂" % [name, t])
			for s in sides:
				out.append(["b.bw_" + s, width])
			return out
		"border-width":
			return _four(tokens, "b.bw_", SIDES, line, name)
		"border-top-width", "border-right-width", "border-bottom-width", "border-left-width":
			return _one_len("b.bw_" + name.substr(7, 1), value, line, name)
		"border-color", "border-top-color", "border-right-color", "border-bottom-color", "border-left-color":
			if tokens.size() > 1:
				_warn(line, "Godot 的边框只有一种颜色，用了第一个")
			return _one_color("b.bc", tokens[0], line, name)
		"border-style":
			if v == "none" or v == "hidden":
				return [["b.bw_t", 0.0], ["b.bw_r", 0.0], ["b.bw_b", 0.0], ["b.bw_l", 0.0]]
			return []
		"border-radius":
			if value.contains("/"):
				_warn(line, "椭圆圆角不支持，只取 / 前面的部分")
				tokens = _split_ws(value.get_slice("/", 0))
			return _four(tokens, "b.r_", CORNERS, line, name)
		"border-top-left-radius":
			return _one_len("b.r_tl", value, line, name)
		"border-top-right-radius":
			return _one_len("b.r_tr", value, line, name)
		"border-bottom-right-radius":
			return _one_len("b.r_br", value, line, name)
		"border-bottom-left-radius":
			return _one_len("b.r_bl", value, line, name)
		"padding":
			return _four(tokens, "b.pad_", SIDES, line, name)
		"padding-top", "padding-right", "padding-bottom", "padding-left":
			return _one_len("b.pad_" + name.substr(8, 1), value, line, name)
		"box-shadow":
			return _shadow(value, line)
		"outline":
			var out := []
			var width = 1.0
			for t in tokens:
				var tl := t.to_lower()
				if tl == "none" or tl == "0":
					width = 0.0
				elif _len(t) != null:
					width = _len(t)
				elif _color(t) != null:
					out.append(["b.ol_color", _color(t)])
			out.append(["b.ol_w", width])
			return out
		"outline-width":
			return _one_len("b.ol_w", value, line, name)
		"outline-color":
			return _one_color("b.ol_color", value, line, name)
		"outline-offset":
			return _one_len("b.ol_off", value, line, name)
		"outline-style":
			return [["b.ol_w", 0.0]] if v == "none" else []
		"color":
			return _one_color("t.color", value, line, name)
		"caret-color":
			return _one_color("t.caret", value, line, name)
		"font-size":
			return _one_len("t.font_size", value, line, name)
		"font-family":
			return [["t.font_family", value]]
		"font-weight":
			var weights := {"normal": 400, "bold": 700, "lighter": 300, "bolder": 800}
			if weights.has(v):
				return [["t.font_weight", weights[v]]]
			if v.is_valid_int():
				return [["t.font_weight", v.to_int()]]
			_warn(line, "font-weight 看不懂：%s" % value)
			return []
		"font-style":
			return [["t.font_italic", v == "italic" or v == "oblique"]]
		"font":
			_warn(line, "font 简写不支持，请分开写 font-size / font-family / font-weight")
			return []
		"text-shadow":
			if v == "none":
				return [["t.sh_color", Color(0, 0, 0, 0)]]
			var lens := []
			var color = Color(0, 0, 0, 1)
			for t in _split_ws(value.get_slice(",", 0)):
				if _len(t) != null:
					lens.append(_len(t))
				elif _color(t) != null:
					color = _color(t)
			if lens.size() < 2:
				_warn(line, "text-shadow 至少要两个长度：%s" % value)
				return []
			var out := [["t.sh_color", color], ["t.sh_x", lens[0]], ["t.sh_y", lens[1]]]
			if lens.size() > 2:
				out.append(["t.sh_blur", lens[2]])
			return out
		"-webkit-text-stroke", "text-stroke":
			var out := []
			for t in tokens:
				if _len(t) != null:
					out.append(["t.stroke_w", _len(t)])
				elif _color(t) != null:
					out.append(["t.stroke_color", _color(t)])
			return out
		"gap":
			var row = _len(tokens[0])
			var col = _len(tokens[1]) if tokens.size() > 1 else row
			if row == null or col == null:
				_warn(line, "gap 看不懂：%s" % value)
				return []
			return [["t.row_gap", row], ["t.col_gap", col]]
		"row-gap":
			return _one_len("t.row_gap", value, line, name)
		"column-gap":
			return _one_len("t.col_gap", value, line, name)
	if name.begins_with("-godot-"):
		return _raw(name.substr(7), value, line)
	_warn(line, "属性 %s 不支持，已忽略" % name)
	return []


## -godot-<种类>-<条目名>: 值 —— 直接写一个 Theme 条目，给 CSS 映射不到的那些用
func _raw(rest: String, value: String, line: int) -> Array:
	for kind in ["font-size", "constant", "color", "font", "icon"]:
		if rest.begins_with(kind + "-"):
			var item := rest.substr(kind.length() + 1).replace("-", "_")
			var parsed = null
			match kind:
				"color":
					parsed = _color(value)
				"constant", "font-size":
					parsed = _len(value)
				"font", "icon":
					parsed = _load_url(value, "Font" if kind == "font" else "Texture2D", line)
			if parsed == null:
				_warn(line, "-godot-%s 的值看不懂：%s" % [rest, value])
				return []
			return [["r.%s.%s" % [kind, item], parsed]]
	_warn(line, "-godot-%s 不认识，可用：-godot-color-*、-godot-constant-*、-godot-font-size-*、-godot-font-*、-godot-icon-*" % rest)
	return []


func _four(tokens: Array, prefix: String, keys: Array, line: int, name: String) -> Array:
	var vals := []
	for t in tokens:
		var n = _len(t)
		if n == null:
			_warn(line, "%s 里的 %s 不是长度" % [name, t])
			return []
		vals.append(n)
	if vals.is_empty() or vals.size() > 4:
		_warn(line, "%s 要 1 到 4 个值" % name)
		return []
	# CSS 的 1~4 值简写：上 右 下 左 / 左上 右上 右下 左下
	var idx: Array = [[0, 0, 0, 0], [0, 1, 0, 1], [0, 1, 2, 1], [0, 1, 2, 3]][vals.size() - 1]
	var out := []
	for i in 4:
		out.append([prefix + keys[i], vals[idx[i]]])
	return out


func _one_len(key: String, value: String, line: int, name: String) -> Array:
	var n = _len(value)
	if n == null:
		_warn(line, "%s 不是长度：%s" % [name, value])
		return []
	return [[key, n]]


func _one_color(key: String, value: String, line: int, name: String) -> Array:
	var c = _color(value)
	if c == null:
		_warn(line, "%s 不是颜色：%s" % [name, value])
		return []
	return [[key, c]]


func _shadow(value: String, line: int) -> Array:
	if value.to_lower() == "none":
		return [["b.sh_size", 0.0]]
	var first := value
	var comma := _find_top(value, ",", 0)
	if comma != -1:
		_warn(line, "Godot 只能画一层阴影，用了第一层")
		first = value.left(comma)
	var lens := []
	var color = Color(0, 0, 0, 0.5)
	for t in _split_ws(first):
		if t.to_lower() == "inset":
			_warn(line, "内阴影 inset 不支持")
			return []
		if _len(t) != null:
			lens.append(_len(t))
		elif _color(t) != null:
			color = _color(t)
	if lens.size() < 2:
		_warn(line, "box-shadow 至少要两个长度：%s" % value)
		return []
	var blur: float = lens[2] if lens.size() > 2 else 0.0
	var spread: float = lens[3] if lens.size() > 3 else 0.0
	return [
		["b.sh_x", lens[0]], ["b.sh_y", lens[1]],
		["b.sh_size", maxf(0.0, blur + spread)], ["b.sh_color", color],
	]


# ---------------------------------------------------------------- 值


## 按空白切开，括号和引号里的不切
func _split_ws(value: String) -> Array[String]:
	var out: Array[String] = []
	var depth := 0
	var quote := ""
	var start := -1
	for i in value.length():
		var ch := value[i]
		var is_space := ch in [" ", "\t", "\n", "\r"]
		if quote != "":
			if ch == quote:
				quote = ""
		elif ch == "\"" or ch == "'":
			quote = ch
		elif ch == "(":
			depth += 1
		elif ch == ")":
			depth -= 1
		if is_space and depth == 0 and quote == "":
			if start != -1:
				out.append(value.substr(start, i - start))
				start = -1
		elif start == -1:
			start = i
	if start != -1:
		out.append(value.substr(start))
	return out


## 长度 → 像素。认 px、无单位、rem / em（按 16px 算）。不是长度返回 null
func _len(token: String):
	var t := token.strip_edges().to_lower()
	var mult := 1.0
	if t.ends_with("px"):
		t = t.left(t.length() - 2)
	elif t.ends_with("rem"):
		t = t.left(t.length() - 3)
		mult = ROOT_FONT_SIZE
	elif t.ends_with("em"):
		t = t.left(t.length() - 2)
		mult = ROOT_FONT_SIZE
	if t == "" or not t.is_valid_float():
		return null
	return t.to_float() * mult


## 颜色 → Color。认 #hex、rgb()/rgba()、hsl()/hsla()、transparent 和颜色名。不是颜色返回 null
func _color(token: String):
	var t := token.strip_edges().to_lower()
	if t == "transparent":
		return Color(0, 0, 0, 0)
	if t.begins_with("#"):
		return Color.html(t) if Color.html_is_valid(t) else null
	if t.begins_with("rgb(") or t.begins_with("rgba(") or t.begins_with("hsl(") or t.begins_with("hsla("):
		if not t.ends_with(")"):
			return null
		var inner := t.substr(t.find("(") + 1)
		inner = inner.left(inner.length() - 1).replace(",", " ").replace("/", " ")
		var parts := _split_ws(inner)
		if parts.size() < 3 or parts.size() > 4:
			return null
		var alpha := 1.0
		if parts.size() == 4:
			alpha = _fraction(parts[3], 1.0)
		if t.begins_with("rgb"):
			return Color(_fraction(parts[0], 255.0), _fraction(parts[1], 255.0), _fraction(parts[2], 255.0), alpha)
		var h := parts[0].trim_suffix("deg")
		if not h.is_valid_float():
			return null
		return _hsl(fposmod(h.to_float(), 360.0) / 360.0, _fraction(parts[1], 100.0), _fraction(parts[2], 100.0), alpha)
	# Color.from_string 会把不带 # 的 "bad" 当十六进制，CSS 不认，先挡掉
	if Color.html_is_valid(t) or not t.replace("-", "").is_valid_identifier():
		return null
	t = t.replace("-", "").replace("grey", "gray")
	t = CSS_ONLY_NAMES.get(t, t)
	var sentinel := Color(-1, -1, -1, -1)
	var named := Color.from_string(t, sentinel)
	return null if named == sentinel else named


func _fraction(part: String, scale: float) -> float:
	if part.ends_with("%"):
		return clampf(part.trim_suffix("%").to_float() / 100.0, 0.0, 1.0)
	return clampf(part.to_float() / scale, 0.0, 1.0)


func _hsl(h: float, s: float, l: float, a: float) -> Color:
	var q := l * (1.0 + s) if l < 0.5 else l + s - l * s
	var p := 2.0 * l - q
	return Color(_hue(p, q, h + 1.0 / 3.0), _hue(p, q, h), _hue(p, q, h - 1.0 / 3.0), a)


func _hue(p: float, q: float, t: float) -> float:
	t = fposmod(t, 1.0)
	if t < 1.0 / 6.0:
		return p + (q - p) * 6.0 * t
	if t < 0.5:
		return q
	if t < 2.0 / 3.0:
		return p + (q - p) * (2.0 / 3.0 - t) * 6.0
	return p


## url(res://x.ttf) 或带引号的路径 → 资源；相对路径按 CSS 文件所在目录算
func _load_url(value: String, type_hint: String, line: int):
	var path := value.strip_edges()
	if path.begins_with("url(") and path.ends_with(")"):
		path = path.substr(4, path.length() - 5).strip_edges()
	path = path.trim_prefix("\"").trim_suffix("\"").trim_prefix("'").trim_suffix("'")
	if not path.begins_with("res://") and not path.begins_with("user://"):
		path = _base_dir.path_join(path).simplify_path()
	if not ResourceLoader.exists(path):
		_warn(line, "找不到 %s" % path)
		return null
	var res := ResourceLoader.load(path, type_hint)
	if res == null or not res.is_class(type_hint):
		_warn(line, "%s 不是 %s" % [path, type_hint])
		return null
	return res


func _make_font(family: String, weight, italic, line: int) -> Font:
	var w: int = 400 if weight == null else weight
	var it: bool = false if italic == null else italic
	if family == "":
		var sys := SystemFont.new()
		sys.font_weight = w
		sys.font_italic = it
		return sys
	var first := family.get_slice(",", 0).strip_edges()
	if first.begins_with("url("):
		var font = _load_url(first, "Font", line)
		if font == null:
			return null
		if w < 600 and not it:
			return font
		# 字体文件没有粗体 / 斜体字重时，用 FontVariation 模拟
		var variation := FontVariation.new()
		variation.base_font = font
		if w >= 600:
			variation.variation_embolden = 0.6
		if it:
			variation.variation_transform = Transform2D(Vector2(1.0, 0.2), Vector2(0.0, 1.0), Vector2.ZERO)
		return variation
	var names := PackedStringArray()
	for n in family.split(","):
		names.append(n.strip_edges().trim_prefix("\"").trim_suffix("\"").trim_prefix("'").trim_suffix("'"))
	var sys_font := SystemFont.new()
	sys_font.font_names = names
	sys_font.font_weight = w
	sys_font.font_italic = it
	return sys_font


# ---------------------------------------------------------------- 生成 Theme


func _build() -> Theme:
	var theme := Theme.new()
	_build_root(theme)

	# 先列出要生成的类型：不带类名的类型选择器各一个，每个类名一个变体
	var elements := []
	var class_base := {}
	for r in _rules:
		if r.cls == "":
			if not elements.has(r.element):
				elements.append(r.element)
		elif not class_base.has(r.cls) or class_base[r.cls] == "":
			class_base[r.cls] = r.element
		elif r.element != "" and r.element != class_base[r.cls]:
			_warn(r.line, ".%s 已经按 %s 的变体生成了，%s.%s 的规则不会生效" % [r.cls, class_base[r.cls], r.element, r.cls])
	for el in elements:
		_build_type(theme, el, "")
	for cls in class_base:
		var base: String = class_base[cls]
		# 没有基类的变体 Godot 查主题时直接跳过，所以 .card 挂在 Control 下：
		# 任何控件都能用，检查器的 theme_type_variation 下拉框里也列得出来
		theme.set_type_variation(cls, base if base != "" else "Control")
		_build_type(theme, base, cls)
	return theme


func _build_root(theme: Theme) -> void:
	var family = null
	var weight = null
	var italic = null
	var line := 0
	for d in _root_entries:
		if d.name.begins_with("--"):
			continue
		line = d.line
		var value := _resolve_vars(d.value, d.line)
		match d.name:
			"font-size":
				var n = _len(value)
				if n != null:
					theme.default_font_size = int(n)
				else:
					_warn(d.line, "font-size 不是长度：%s" % value)
			"font-family":
				family = value
			"font-weight", "font-style":
				var kv := _expand(d.name, value, d.line)
				if not kv.is_empty():
					if d.name == "font-weight":
						weight = kv[0][1]
					else:
						italic = kv[0][1]
			_:
				_warn(d.line, ":root / * 里只认 --变量、font-size、font-family、font-weight、font-style，%s 请写到具体类型上" % d.name)
	if family != null or weight != null or italic != null:
		var font := _make_font("" if family == null else family, weight, italic, line)
		if font != null:
			theme.default_font = font


func _matches(r: Dictionary, el: String, cls: String) -> bool:
	if r.element != "" and r.element != el:
		return false
	return r.cls == "" or r.cls == cls


## 按 CSS 层叠把命中的声明合成一个字典
func _merge(el: String, cls: String, states: Array, part: String, focus_box: bool) -> Dictionary:
	var hits := []
	for r in _rules:
		if not PART_INHERIT.get(part, [part]).has(r.part) or not _matches(r, el, cls) or not states.has(r.state):
			continue
		for e in r.entries:
			if focus_box and r.state != "focus" and e.k.begins_with("b.") and not FOCUS_INHERITED.has(e.k):
				continue
			hits.append([1 if e.imp else 0, r.spec, e.order, e.k, e.v])
	hits.sort_custom(func(a, b): return a[0] < b[0] or (a[0] == b[0] and (a[1] < b[1] or (a[1] == b[1] and a[2] < b[2]))))
	var d := {}
	for h in hits:
		d[h[3]] = h[4]
	return d


func _has_box(d: Dictionary, ignore: Array) -> bool:
	for k in d:
		if k.begins_with("b.") and not ignore.has(k):
			return true
	return false


func _build_type(theme: Theme, el: String, cls: String) -> void:
	var type_name := cls if cls != "" else el
	var profile: Dictionary = BARE_PROFILE if el == "" else PROFILES.get(el, DEFAULT_PROFILE)
	var boxes: Array = profile.boxes.duplicate()
	var used_states := {}
	var parts := {}
	for r in _rules:
		if not _matches(r, el, cls):
			continue
		if r.part != "" and not parts.has(r.part):
			parts[r.part] = r.line
	# 只写了 ::grabber-area 时高亮那段也跟着写，否则一悬停就跳回 Godot 默认的样子
	for inherited in PART_INHERIT:
		for source in PART_INHERIT[inherited]:
			if parts.has(source) and not parts.has(inherited) and STATE_REDIRECT.has(el):
				parts[inherited] = parts[source]
	for r in _rules:
		if not _matches(r, el, cls):
			continue
		if r.state != "" and not used_states.has(r.state):
			used_states[r.state] = r.line
	for s in used_states:
		if el == "" and not boxes.has(s):
			boxes.append(s)
		elif not boxes.has(s) and not profile.colors.has(s) and not profile.get("aliases", {}).has(s):
			_warn(used_states[s], "%s 没有 %s 状态的样式，对应的规则不会生效（它的 stylebox 只有：%s，可以用 ::名字 直接写）" % [type_name, s, ", ".join(_stylebox_names(el))])

	var base := _merge(el, cls, [""], "", false)

	for box in boxes:
		var is_focus: bool = box == "focus"
		var d := _merge(el, cls, STATE_MATCH.get(box, [""]), "", is_focus)
		if is_focus:
			if not _has_box(d, ["b.r_tl", "b.r_tr", "b.r_br", "b.r_bl"]):
				continue
		elif not _has_box(d, FOCUS_INHERITED.slice(4)):
			continue
		theme.set_stylebox(box, type_name, _make_stylebox(d, is_focus))
	if profile.boxes.is_empty() and profile.get("padding", "") == "" and _has_box(base, []):
		_warn(0, "%s 自己不画背景（没有 stylebox），背景 / 边框 / 内边距请写在外面包的 PanelContainer 上" % type_name)

	for state in profile.colors:
		var d := _merge(el, cls, STATE_MATCH.get(state, [""]), "", false)
		if d.has("t.color"):
			theme.set_color(profile.colors[state], type_name, d["t.color"])

	if base.has("t.font_size"):
		theme.set_font_size(profile.get("font_size", "font_size"), type_name, int(base["t.font_size"]))
	if base.has("t.font_family") or base.has("t.font_weight") or base.has("t.font_italic"):
		var font := _make_font(base.get("t.font_family", ""), base.get("t.font_weight"), base.get("t.font_italic"), 0)
		if font != null:
			theme.set_font(profile.get("font", "font"), type_name, font)
	if base.has("t.sh_color"):
		theme.set_color("font_shadow_color", type_name, base["t.sh_color"])
		theme.set_constant("shadow_offset_x", type_name, int(base.get("t.sh_x", 0)))
		theme.set_constant("shadow_offset_y", type_name, int(base.get("t.sh_y", 0)))
		if base.has("t.sh_blur"):
			theme.set_constant("shadow_outline_size", type_name, int(base["t.sh_blur"]))
	if base.has("t.stroke_w"):
		theme.set_constant("outline_size", type_name, int(base["t.stroke_w"]))
	if base.has("t.stroke_color"):
		theme.set_color("font_outline_color", type_name, base["t.stroke_color"])
	if base.has("t.caret"):
		theme.set_color("caret_color", type_name, base["t.caret"])
	if base.has("t.row_gap") or base.has("t.col_gap"):
		match profile.get("gap", "grid"):
			"separation":
				var vertical := el.begins_with("V")
				theme.set_constant("separation", type_name, int(base.get("t.row_gap" if vertical else "t.col_gap", 0)))
			"button":
				theme.set_constant("h_separation", type_name, int(base.get("t.col_gap", 0)))
			_:
				theme.set_constant("h_separation", type_name, int(base.get("t.col_gap", 0)))
				theme.set_constant("v_separation", type_name, int(base.get("t.row_gap", 0)))
	if profile.get("padding", "") == "margins":
		var names := {"t": "margin_top", "r": "margin_right", "b": "margin_bottom", "l": "margin_left"}
		for s in SIDES:
			if base.has("b.pad_" + s):
				theme.set_constant(names[s], type_name, int(base["b.pad_" + s]))
	for k in base:
		if k.begins_with("r."):
			var kind: String = k.get_slice(".", 1)
			var item: String = k.get_slice(".", 2)
			match kind:
				"color": theme.set_color(item, type_name, base[k])
				"constant": theme.set_constant(item, type_name, int(base[k]))
				"font-size": theme.set_font_size(item, type_name, int(base[k]))
				"font": theme.set_font(item, type_name, base[k])
				"icon": theme.set_icon(item, type_name, base[k])

	for part in parts:
		var d := _merge(el, cls, [""], part, false)
		match part:
			"placeholder":
				if d.has("t.color"):
					theme.set_color("font_placeholder_color", type_name, d["t.color"])
			"selection":
				if d.has("b.bg"):
					theme.set_color("selection_color", type_name, d["b.bg"])
				if d.has("t.color"):
					theme.set_color("font_selected_color", type_name, d["t.color"])
			_:
				var names := _stylebox_names(el)
				if not names.is_empty() and not names.has(part):
					_warn(parts[part], "Godot 的 %s 没有叫 %s 的 stylebox，写了也不会画（它有：%s），已跳过" % [el, part, ", ".join(names)])
				elif _has_box(d, []):
					theme.set_stylebox(part, type_name, _make_stylebox(d, false))
				else:
					_warn(parts[part], "%s::%s 只认背景、边框、圆角、内边距、阴影" % [type_name, part])


## 这个控件类型真有哪些 stylebox。从实例的 theme_override_styles/* 属性读，
## 比默认主题里登记的全（默认主题没写 Button 的 hover_pressed，但 Button 认它）
func _stylebox_names(el: String) -> PackedStringArray:
	if _stylebox_names_cache.has(el):
		return _stylebox_names_cache[el]
	var names := PackedStringArray()
	if el != "" and ClassDB.class_exists(el) and ClassDB.can_instantiate(el):
		var node = ClassDB.instantiate(el)
		if node is Control:
			for p in (node as Control).get_property_list():
				if p.name.begins_with("theme_override_styles/"):
					names.append(p.name.trim_prefix("theme_override_styles/"))
		if node is Node:
			node.free()
	_stylebox_names_cache[el] = names
	return names


func _make_stylebox(d: Dictionary, is_focus: bool) -> StyleBox:
	var widths := []
	for s in SIDES:
		widths.append(d.get("b.bw_" + s, 0.0))
	var border_color = d.get("b.bc", d.get("t.color", Color(0.8, 0.8, 0.8)))
	var expand := 0.0
	if is_focus and d.has("b.ol_w"):
		var ol: float = d["b.ol_w"]
		if ol > 0.0:
			widths = [ol, ol, ol, ol]
			border_color = d.get("b.ol_color", d.get("t.color", Color(1, 1, 1, 0.75)))
			# CSS 的 outline 画在边框外面；StyleBoxFlat 的边框画在里面，用 expand_margin 推出去
			expand = ol + d.get("b.ol_off", 0.0)
	var has_bg: bool = d.has("b.bg") and not d.get("b.bg_none", false)
	var has_border: bool = widths.max() > 0.0
	var has_shadow: bool = d.get("b.sh_size", 0.0) > 0.0

	var sb: StyleBox
	if not has_bg and not has_border and not has_shadow:
		sb = StyleBoxEmpty.new()
	else:
		var flat := StyleBoxFlat.new()
		flat.draw_center = has_bg
		flat.bg_color = d["b.bg"] if has_bg else Color(0, 0, 0, 0)
		flat.border_width_top = int(widths[0])
		flat.border_width_right = int(widths[1])
		flat.border_width_bottom = int(widths[2])
		flat.border_width_left = int(widths[3])
		flat.border_color = border_color
		flat.corner_radius_top_left = int(d.get("b.r_tl", 0))
		flat.corner_radius_top_right = int(d.get("b.r_tr", 0))
		flat.corner_radius_bottom_right = int(d.get("b.r_br", 0))
		flat.corner_radius_bottom_left = int(d.get("b.r_bl", 0))
		if has_shadow:
			flat.shadow_size = int(d["b.sh_size"])
			flat.shadow_color = d.get("b.sh_color", Color(0, 0, 0, 0.5))
			flat.shadow_offset = Vector2(d.get("b.sh_x", 0.0), d.get("b.sh_y", 0.0))
		if expand != 0.0:
			flat.expand_margin_top = expand
			flat.expand_margin_right = expand
			flat.expand_margin_bottom = expand
			flat.expand_margin_left = expand
		sb = flat
	if d.has("b.pad_t"):
		sb.content_margin_top = d["b.pad_t"]
	if d.has("b.pad_r"):
		sb.content_margin_right = d["b.pad_r"]
	if d.has("b.pad_b"):
		sb.content_margin_bottom = d["b.pad_b"]
	if d.has("b.pad_l"):
		sb.content_margin_left = d["b.pad_l"]
	return sb
