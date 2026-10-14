<template>
  <svg viewBox="0 0 64 64" aria-hidden="true" focusable="false">
    <path
      d="M27 10H10v17M37 10h17v17M54 37v17H37M27 54H10V37"
      fill="none"
      stroke="currentColor"
      stroke-width="7"
    />
    <!-- 2×2 像素瓦片，和 build/icon.svg 同形：三块次要色、右下一块主色 -->
    <g class="brand-mark-secondary" fill="currentColor">
      <rect x="23" y="23" width="8.2" height="8.2" />
      <rect x="32.8" y="23" width="8.2" height="8.2" />
      <rect x="23" y="32.8" width="8.2" height="8.2" />
    </g>
    <rect x="32.8" y="32.8" width="8.2" height="8.2" fill="currentColor" />
  </svg>
</template>

<style scoped>
.brand-mark-secondary {
  color: var(--color-text-muted);
}
</style>
