# GDBox CSS

用 CSS 写 Godot 4 的界面主题。`.css` 文件会被导入成原生 `Theme` 资源，
运行期没有任何额外开销 —— 游戏里拿到的就是普通的 Theme、StyleBoxFlat、颜色和常量。

## 用法

1. 把 `addons/gdbox_css` 拷进工程，在 项目设置 → 插件 里启用 GDBox CSS。
2. 在工程里新建 `ui.css`（用外部编辑器写，切回 Godot 会自动重新导入）。
3. 把 `ui.css` 拖到任意 Control 的 `theme` 属性上，或者填进
   项目设置 → GUI → 主题 → 自定义，整个游戏生效。

代码里：`load("res://ui.css")` 得到 Theme。想在运行期从 `user://` 或模组读 CSS 换肤：
`GdCss.load_theme("user://skin.css")`。

```css
:root {
  --accent: #3b82f6;
  --radius: 6px;
  font-size: 16px;
  font-family: url("res://fonts/NotoSansSC.ttf");
}

Button {
  background: var(--accent);
  color: white;
  border-radius: var(--radius);
  padding: 6px 14px;
}
Button:hover    { background: #60a5fa; }
Button:active   { background: #1d4ed8; }
Button:disabled { background: #334155; color: rgba(255, 255, 255, 0.4); }
Button:focus    { outline: 2px solid white; outline-offset: 1px; }

/* 节点的 theme_type_variation 填 danger */
Button.danger { background: hsl(0, 70%, 50%); }

.card {
  background: #1e1e24;
  border: 1px solid #333;
  border-radius: 10px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.5);
  padding: 16px;
}

ProgressBar::fill     { background: lime; border-radius: 3px; }
LineEdit::placeholder { color: gray; }
VBoxContainer         { gap: 12px; }
MarginContainer       { padding: 8px 16px; }
Label                 { color: #eee; text-shadow: 1px 1px #000; }
```

## 选择器

| 写法 | 对应到 Theme |
|---|---|
| `Button` | 类型 `Button` |
| `Button.primary` | 类型变体 `primary`（基类 Button），节点 `theme_type_variation` 填 `primary`。类名里的 `-` 会变成 `_` |
| `.card` | 挂在 `Control` 下的变体，任何控件都能用；写 `panel` 和 `normal` 两个 stylebox，不继承类型规则 |
| `:hover` `:active`/`:pressed`/`:checked` `:disabled` `:focus` `:read-only` | 对应状态的 stylebox 和字色；`:hover:active` → `hover_pressed` |
| `::fill`、`::tab-selected` … | 直接写这个名字的 stylebox；这个类型没有这个 stylebox 时给警告并列出它有哪些 |
| `HSlider:focus` / `:hover` | 滑块没有 focus stylebox，焦点和悬停时 Godot 画的是 `grabber_area_highlight`，写进那里（继承 `::grabber-area`） |
| `HScrollBar:focus` | 写进 `scroll_focus`，继承滚动条的基础样式 |
| `::placeholder` `::selection` | `font_placeholder_color`；`selection_color` / `font_selected_color` |
| `:root` / `*` | `--变量`、全局 `font-size`、`font-family`、`font-weight`、`font-style` |

层叠照 CSS：`!important` > 特异性 > 书写顺序；`Button:hover` 继承 `Button` 的全部声明，
`Button.danger` 也是。例外是 `:focus` —— Godot 把 focus stylebox 叠在上面画，
所以它只继承圆角，不继承背景和边框。

后代 / 子代选择器、`#id`、属性选择器 Theme 表达不了，会在输出面板给出带行号的警告并跳过。

## 属性

| CSS | Godot |
|---|---|
| `background` / `background-color`（纯色，`none`） | StyleBoxFlat `bg_color`；`none` → 不画底 |
| `border`、`border-width`、`border-color`、`border-style`、`border-top` … | `border_width_*`、`border_color`（Godot 边框只有一种颜色；没写颜色时用 `color`） |
| `border-radius`（1~4 值）及各角 | `corner_radius_*` |
| `padding`（1~4 值）及各边 | `content_margin_*`；MarginContainer 上是 `margin_*` 常量 |
| `box-shadow` | `shadow_offset`、`shadow_size`（模糊 + 扩散）、`shadow_color`，只取第一层 |
| `outline`、`outline-width/-color/-offset` | `:focus` 的边框，用 `expand_margin` 画到外面；`outline: none` → 空 focus |
| `color` | 各状态的字色（`font_color`、`font_hover_color` …） |
| `font-size`、`font-family`、`font-weight`、`font-style` | `font_size`、`font`。`url(...)` 加载字体文件，字体名走 SystemFont |
| `text-shadow` | `font_shadow_color`、`shadow_offset_x/y`、`shadow_outline_size` |
| `-webkit-text-stroke` | `outline_size`、`font_outline_color` |
| `caret-color` | `caret_color` |
| `gap`、`row-gap`、`column-gap` | Box 容器 `separation`，Grid / Flow `h_separation`、`v_separation`，按钮的图标间距 `h_separation` |

长度认 `px`、无单位和 `rem`/`em`（按 16px）。颜色认 `#rgb(a)`、`#rrggbb(aa)`、`rgb()`/`rgba()`、
`hsl()`/`hsla()`、`transparent` 和 CSS 颜色名（`gray`、`green` 等按 CSS 的值，不是 Godot 的 X11 值）。

映射不到的 Theme 条目用 `-godot-<种类>-<条目名>` 直接写：

```css
Label    { -godot-constant-line-spacing: 4; }
CheckBox { -godot-icon-checked: url("res://ui/check.svg"); }
Tree     { -godot-color-guide-color: #444; -godot-font-size-title-button-font-size: 14; }
```

种类有 `color`、`constant`、`font-size`、`font`、`icon`。

## 注意

- 一旦给某个类型写了背景 / 边框 / 内边距，这个状态的 stylebox 就整个换成你写的，
  不会再叠 Godot 默认主题的那一份。所以按钮至少写上 `background` 和 `padding`。
- HBoxContainer、VBoxContainer 这类容器自己不画背景，背景请写在外面包的 PanelContainer 上。
- 渐变、背景图、`transition`、`opacity` 等 StyleBoxFlat 画不了，会给警告。
