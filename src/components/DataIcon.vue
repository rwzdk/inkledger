<script setup>
/**
 * 数据图标字段渲染:":key" 走注册表线性图标,其余(emoji / 自定义文本)按文本显示,
 * 保证旧版本保存在 localStorage / GitHub 里的分类数据无需迁移即可正常展示
 */
import { computed } from 'vue'
import AppIcon from './AppIcon.vue'
import { parseIconKey } from '../lib/icons.js'

const props = defineProps({
  icon: { type: String, default: '' },
  size: { type: [Number, String], default: 18 },
  fallback: { type: String, default: '' }
})

const key = computed(() => parseIconKey(props.icon))
const text = computed(() => (key.value ? '' : props.icon || props.fallback))
</script>

<template>
  <AppIcon v-if="key" :name="key" :size="size" />
  <span v-else-if="text" class="data-icon__text">{{ text }}</span>
</template>
