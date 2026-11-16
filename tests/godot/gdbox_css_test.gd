extends SceneTree

## GDBox CSS 的无头测试。由 tests/unit/gdbox-css.test.ts 拷进临时工程后运行：
##   godot --headless --path <工程> --script res://gdbox_css_test.gd
## 每条失败打一行 FAIL，退出码 = 失败条数。

const GdCssCompiler := preload("res://addons/gdbox_css/gdcss.gd")

const CSS := """:root {
	--accent: #3b82f6;
	--radius: 6px;
	font-size: 18px;
}
Button {
	background: var(--accent);
	color: white;
	border-radius: var(--radius);
	padding: 6px 12px;
}
Button:hover { background: #60a5fa; }
Button:hover:active { background: navy; }
Button:disabled { color: rgba(255, 255, 255, 0.4); }
Button:focus { outline: 2px solid #fff; outline-offset: 1px; }
Button.danger { background: hsl(0, 70%, 50%); }
.card {
	background: #222;
	border: 1px solid #444;
	box-shadow: 0 4px 12px rgba(0, 0, 0, .5);
}
PanelContainer { background-color: #111 !important; }
PanelContainer { background-color: #333; }
ProgressBar::fill { background: lime; border-radius: 3px; }
LineEdit::placeholder { color: gray; }
LineEdit:focus { outline: none; }
VBoxContainer { gap: 12px; }
MarginContainer { padding: 4px 8px; }
Label { color: #eee; text-shadow: 1px 2px #000; -godot-constant-line-spacing: 4; }
/* 注释里的 { 不会被当成规则 */
div > p { color: red; }
Button {
	transition: all 1s;
}
"""

## 滑块和滚动条没有 focus stylebox，Godot 在焦点时画的是别的部件
const SLIDER_CSS := """HSlider::grabber-area { background: teal; border-radius: 4px; }
HSlider:focus { background: cyan; }
VSlider::grabber-area { background: teal; }
HScrollBar { background: #111; }
HScrollBar:focus { border: 1px solid cyan; }
HSlider::focus { background: red; }
"""

var failures := 0


func check(cond: bool, what: String) -> void:
	if not cond:
		failures += 1
		print("FAIL ", what)


func near(a: Color, b: Color) -> bool:
	return a.is_equal_approx(b) or (absf(a.r - b.r) < 0.01 and absf(a.g - b.g) < 0.01 and absf(a.b - b.b) < 0.01 and absf(a.a - b.a) < 0.01)


func _initialize() -> void:
	var compiler := GdCssCompiler.new()
	var theme := compiler.compile(CSS)
	var accent := Color("#3b82f6")

	check(theme.default_font_size == 18, ":root font-size → default_font_size")

	var normal := theme.get_stylebox("normal", "Button") as StyleBoxFlat
	check(normal != null and near(normal.bg_color, accent), "var() 展开成背景色")
	check(normal != null and normal.corner_radius_top_left == 6 and normal.corner_radius_bottom_right == 6, "border-radius")
	check(normal != null and normal.content_margin_top == 6 and normal.content_margin_left == 12, "padding 两值简写")

	var hover := theme.get_stylebox("hover", "Button") as StyleBoxFlat
	check(hover != null and near(hover.bg_color, Color("#60a5fa")), ":hover 背景")
	check(hover != null and hover.corner_radius_top_left == 6 and hover.content_margin_left == 12, ":hover 继承圆角和内边距")
	var pressed := theme.get_stylebox("pressed", "Button") as StyleBoxFlat
	check(pressed != null and near(pressed.bg_color, accent), "没写 :active 时 pressed 和基础样式一样")
	var hover_pressed := theme.get_stylebox("hover_pressed", "Button") as StyleBoxFlat
	check(hover_pressed != null and near(hover_pressed.bg_color, Color.NAVY_BLUE), ":hover:active → hover_pressed，颜色名")

	check(near(theme.get_color("font_color", "Button"), Color.WHITE), "color → font_color")
	check(near(theme.get_color("font_hover_color", "Button"), Color.WHITE), "color 传到各状态字色")
	check(near(theme.get_color("font_disabled_color", "Button"), Color(1, 1, 1, 0.4)), ":disabled 字色 rgba()")

	var focus := theme.get_stylebox("focus", "Button") as StyleBoxFlat
	check(focus != null and not focus.draw_center, ":focus 不继承背景")
	check(focus != null and focus.border_width_top == 2 and is_equal_approx(focus.expand_margin_left, 3.0), "outline → 外扩边框")
	check(focus != null and focus.corner_radius_top_left == 6, ":focus 继承圆角")
	check(theme.get_stylebox("focus", "LineEdit") is StyleBoxEmpty, "outline: none → 空 focus")

	check(theme.is_type_variation("danger", "Button"), "Button.danger 注册为 Button 的变体")
	var danger := theme.get_stylebox("normal", "danger") as StyleBoxFlat
	check(danger != null and near(danger.bg_color, Color(0.85, 0.15, 0.15)), "hsl()")
	check(danger != null and danger.corner_radius_top_left == 6, "变体继承类型规则")
	check(near(theme.get_color("font_color", "danger"), Color.WHITE), "变体继承字色")

	var card := theme.get_stylebox("panel", "card") as StyleBoxFlat
	check(card != null and near(card.bg_color, Color("#222")) and card.border_width_left == 1 and near(card.border_color, Color("#444")), "border 简写")
	check(card != null and card.shadow_size == 12 and card.shadow_offset == Vector2(0, 4) and is_equal_approx(card.shadow_color.a, 0.5), "box-shadow")

	var panel := theme.get_stylebox("panel", "PanelContainer") as StyleBoxFlat
	check(panel != null and near(panel.bg_color, Color("#111")), "!important 压过后写的规则")

	var fill := theme.get_stylebox("fill", "ProgressBar") as StyleBoxFlat
	check(fill != null and near(fill.bg_color, Color.LIME) and fill.corner_radius_top_left == 3, "::fill 直接指定 stylebox")
	check(near(theme.get_color("font_placeholder_color", "LineEdit"), Color.WEB_GRAY), "::placeholder 用 CSS 的 gray 而不是 X11 的")
	check(theme.get_constant("separation", "VBoxContainer") == 12, "gap → separation")
	check(theme.get_constant("margin_top", "MarginContainer") == 4 and theme.get_constant("margin_left", "MarginContainer") == 8, "MarginContainer 的 padding → margin_*")
	check(near(theme.get_color("font_shadow_color", "Label"), Color.BLACK) and theme.get_constant("shadow_offset_y", "Label") == 2, "text-shadow")
	check(theme.get_constant("line_spacing", "Label") == 4, "-godot-constant-*")

	var joined := "\n".join(compiler.warnings)
	check(joined.contains("div > p"), "不支持的选择器给警告")
	check(joined.contains("33: 属性 transition 不支持"), "警告行号对得上：" + joined)
	check(compiler.warnings.size() == 2, "只有这两条警告：" + joined)

	var slider_compiler := GdCssCompiler.new()
	var slider_theme := slider_compiler.compile(SLIDER_CSS)
	var highlight := slider_theme.get_stylebox("grabber_area_highlight", "HSlider") as StyleBoxFlat
	check(highlight != null and near(highlight.bg_color, Color.CYAN), "HSlider:focus → grabber_area_highlight")
	check(highlight != null and highlight.corner_radius_top_left == 4, "高亮那段继承 ::grabber-area 的圆角")
	var v_highlight := slider_theme.get_stylebox("grabber_area_highlight", "VSlider") as StyleBoxFlat
	check(v_highlight != null and near(v_highlight.bg_color, Color.TEAL), "只写 ::grabber-area 时高亮那段跟着写")
	var scroll_focus := slider_theme.get_stylebox("scroll_focus", "HScrollBar") as StyleBoxFlat
	check(scroll_focus != null and near(scroll_focus.bg_color, Color("#111")) and scroll_focus.border_width_top == 1, "HScrollBar:focus → scroll_focus，继承基础背景")
	check(not slider_theme.has_stylebox("focus", "HSlider"), "不存在的 ::focus 不写进 Theme")
	var slider_warnings := "\n".join(slider_compiler.warnings)
	check(slider_compiler.warnings.size() == 1 and slider_warnings.contains("6: Godot 的 HSlider 没有叫 focus 的 stylebox") and slider_warnings.contains("grabber_area_highlight"), "警告列出可用的 stylebox：" + slider_warnings)
	var label_compiler := GdCssCompiler.new()
	label_compiler.compile("Label:hover { color: red; }")
	check("\n".join(label_compiler.warnings).contains("它的 stylebox 只有：normal, focus"), "没有的状态在警告里给出可用的 stylebox：" + "\n".join(label_compiler.warnings))

	check(compiler._color("bad") == null and compiler._color("#abc") != null, "不带 # 的十六进制不算颜色")

	# 真控件上看一遍：变体能从 theme_type_variation 查到，没写的状态回落到 Button
	var button := Button.new()
	button.theme = theme
	button.theme_type_variation = "danger"
	root.add_child(button)
	# --script 模式下 _initialize 时 root 还没进树，等一帧控件才查得到主题
	await process_frame
	var live := button.get_theme_stylebox("normal") as StyleBoxFlat
	check(live != null and near(live.bg_color, Color(0.85, 0.15, 0.15)), "控件按变体取到样式")
	var card_node := PanelContainer.new()
	card_node.theme = theme
	card_node.theme_type_variation = "card"
	root.add_child(card_node)
	await process_frame
	var live_card := card_node.get_theme_stylebox("panel") as StyleBoxFlat
	check(live_card != null and near(live_card.bg_color, Color("#222")), "不带基类的 .card 在真控件上生效")
	var live_focus := button.get_theme_stylebox("focus") as StyleBoxFlat
	check(live_focus != null and live_focus.border_width_top == 2 and is_equal_approx(live_focus.expand_margin_left, 3.0), "变体的 focus 来自 Button:focus")

	# 编辑器导入出来的资源（测试外壳先跑了 --import）
	if FileAccess.file_exists("res://ui.css"):
		var imported = load("res://ui.css")
		check(imported is Theme, "导入后 load(.css) 得到 Theme")
		if imported is Theme:
			var sb := (imported as Theme).get_stylebox("normal", "Button") as StyleBoxFlat
			check(sb != null and near(sb.bg_color, accent), "导入的 Theme 内容正确")

	print("DONE failures=%d" % failures)
	quit(failures)
