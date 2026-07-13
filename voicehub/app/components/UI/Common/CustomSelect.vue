<template>
  <div ref="containerRef" class="relative" :class="className">
    <div
      class="flex items-center gap-2 px-3 py-2 border rounded-lg transition-all cursor-pointer select-none"
      :class="[
        triggerThemeClass,
        isOpen ? triggerOpenClass : triggerClosedClass
      ]"
      @click="toggleDropdown"
    >
      <div class="flex flex-col flex-1 min-w-0">
        <span
          v-if="label"
          class="text-[8px] font-black uppercase tracking-widest leading-none mb-0.5 transition-colors"
          :class="isOpen ? labelOpenClass : labelClosedClass"
        >
          {{ label }}
        </span>
        <span class="text-[11px] font-bold truncate" :class="valueTextClass">{{ displayLabel }}</span>
      </div>
      <div class="transition-transform duration-200" :class="{ 'rotate-180': isOpen }">
        <ChevronDown :size="12" :class="isOpen ? chevronOpenClass : chevronClosedClass" />
      </div>
    </div>

    <Teleport to="body">
      <Transition
        enter-active-class="transition duration-100 ease-out"
        enter-from-class="transform scale-95 opacity-0"
        enter-to-class="transform scale-100 opacity-100"
        leave-active-class="transition duration-75 ease-in"
        leave-from-class="transform scale-100 opacity-100"
        leave-to-class="transform scale-95 opacity-0"
      >
        <div
          v-if="isOpen"
          ref="dropdownRef"
          :style="dropdownStyle"
          class="fixed z-[9999] p-1 border rounded-lg shadow-2xl backdrop-blur-xl origin-top"
          :class="dropdownPanelClass"
        >
          <div class="max-h-[200px] overflow-y-auto custom-scrollbar">
            <button
              v-for="option in normalizedOptions"
              :key="option.value"
              class="w-full flex items-center justify-between px-3 py-2 rounded-md text-[11px] font-bold transition-all"
              :class="[
                isSelected(option) ? optionSelectedClass : optionDefaultClass
              ]"
              @click="selectOption(option)"
            >
              <span class="truncate">{{ option.label }}</span>
              <Icon v-if="isSelected(option)" name="check" :size="12" class="shrink-0" />
            </button>
          </div>
        </div>
      </Transition>
    </Teleport>
  </div>
</template>

<script setup>
import { ref, onMounted, onUnmounted, computed, nextTick, watch } from 'vue'
import Icon from '~/components/UI/Icon.vue'

const props = defineProps({
  label: String,
  modelValue: [String, Number, Object],
  value: [String, Number, Object],
  options: {
    type: Array,
    required: true
  },
  className: String,
  labelKey: {
    type: String,
    default: 'label'
  },
  valueKey: {
    type: String,
    default: 'value'
  },
  placeholder: {
    type: String,
    default: '请选择'
  },
  theme: {
    type: String,
    default: 'dark'
  }
})

const emit = defineEmits(['update:modelValue', 'update:value', 'change'])

const isOpen = ref(false)
const containerRef = ref(null)
const dropdownRef = ref(null)
const dropdownStyle = ref({})

// 统一获取当前值
const currentValue = computed(() => {
  if (props.modelValue !== undefined) return props.modelValue
  return props.value
})

const isLightTheme = computed(() => props.theme === 'light')
const triggerThemeClass = computed(() => (isLightTheme.value ? 'bg-white' : 'bg-zinc-950'))
const triggerOpenClass = computed(() =>
  isLightTheme.value
    ? 'border-emerald-400/70 bg-emerald-50/80 shadow-md'
    : 'border-blue-500/50 bg-blue-600/5 shadow-lg'
)
const triggerClosedClass = computed(() =>
  isLightTheme.value ? 'border-emerald-200 hover:border-emerald-300' : 'border-zinc-800 hover:border-zinc-700'
)
const labelOpenClass = computed(() => (isLightTheme.value ? 'text-emerald-600' : 'text-blue-400'))
const labelClosedClass = computed(() => (isLightTheme.value ? 'text-emerald-700/80' : 'text-zinc-600'))
const valueTextClass = computed(() => (isLightTheme.value ? 'text-emerald-900' : 'text-zinc-300'))
const chevronOpenClass = computed(() => (isLightTheme.value ? 'text-emerald-600' : 'text-blue-400'))
const chevronClosedClass = computed(() => (isLightTheme.value ? 'text-emerald-500/80' : 'text-zinc-700'))
const dropdownPanelClass = computed(() =>
  isLightTheme.value
    ? 'bg-[#f7fbf5] border-emerald-200/80 shadow-[0_18px_45px_rgba(49,95,62,0.16)]'
    : 'bg-[#0c0c0e] border-zinc-800'
)
const optionSelectedClass = computed(() =>
  isLightTheme.value ? 'bg-emerald-100 text-emerald-800' : 'bg-blue-600/10 text-blue-400'
)
const optionDefaultClass = computed(() =>
  isLightTheme.value
    ? 'text-emerald-900/85 hover:text-emerald-900 hover:bg-emerald-50'
    : 'text-zinc-500 hover:text-zinc-200 hover:bg-zinc-800/40'
)

// 规范化选项为 { label, value } 格式
const normalizedOptions = computed(() => {
  return props.options.map((option) => {
    if (typeof option === 'object' && option !== null) {
      return {
        label: option[props.labelKey] || option.label,
        value: option[props.valueKey] !== undefined ? option[props.valueKey] : option.value,
        original: option
      }
    }
    return { label: option, value: option, original: option }
  })
})

// 获取当前显示标签
const displayLabel = computed(() => {
  const selected = normalizedOptions.value.find((opt) => opt.value === currentValue.value)
  return selected
    ? selected.label
    : currentValue.value && typeof currentValue.value !== 'object'
      ? currentValue.value
      : props.placeholder
})

const isSelected = (option) => {
  return option.value === currentValue.value
}

const updatePosition = () => {
  if (!isOpen.value || !containerRef.value) return

  const rect = containerRef.value.getBoundingClientRect()

  // 简单的位置计算，默认向下弹出
  // 检查底部空间
  const windowHeight = window.innerHeight
  const spaceBelow = windowHeight - rect.bottom

  const top = rect.bottom + 4

  // 如果底部空间不足且顶部空间充足，则向上弹出
  if (spaceBelow < 220 && rect.top > 220) {
    // 暂时保持向下，或者使用 fixed 定位让它尽量可见
  }

  dropdownStyle.value = {
    top: `${top}px`,
    left: `${rect.left}px`,
    width: `${rect.width}px`,
    minWidth: '120px' // 最小宽度
  }
}

const toggleDropdown = async () => {
  if (isOpen.value) {
    isOpen.value = false
  } else {
    isOpen.value = true
    await nextTick()
    updatePosition()
  }
}

const selectOption = (option) => {
  emit('update:modelValue', option.value)
  emit('update:value', option.value)
  emit('change', option.value)
  isOpen.value = false
}

const handleClickOutside = (event) => {
  // 检查点击是否在容器内部或者下拉框内部
  const isClickInContainer = containerRef.value && containerRef.value.contains(event.target)
  const isClickInDropdown = dropdownRef.value && dropdownRef.value.contains(event.target)

  if (!isClickInContainer && !isClickInDropdown) {
    isOpen.value = false
  }
}

const handleScrollOrResize = () => {
  if (isOpen.value) {
    updatePosition()
  }
}

// 监听 isOpen 变化来添加/移除事件监听
watch(isOpen, (val) => {
  if (val) {
    window.addEventListener('scroll', handleScrollOrResize, true) // capture=true 以捕获子元素的滚动
    window.addEventListener('resize', handleScrollOrResize)
  } else {
    window.removeEventListener('scroll', handleScrollOrResize, true)
    window.removeEventListener('resize', handleScrollOrResize)
  }
})

onMounted(() => {
  document.addEventListener('mousedown', handleClickOutside)
})

onUnmounted(() => {
  document.removeEventListener('mousedown', handleClickOutside)
  window.removeEventListener('scroll', handleScrollOrResize, true)
  window.removeEventListener('resize', handleScrollOrResize)
})
</script>

<style scoped>
.custom-scrollbar::-webkit-scrollbar {
  width: 4px;
}
.custom-scrollbar::-webkit-scrollbar-track {
  background: transparent;
}
.custom-scrollbar::-webkit-scrollbar-thumb {
  background: #27272a;
  border-radius: 10px;
}
.custom-scrollbar::-webkit-scrollbar-thumb:hover {
  background: #3f3f46;
}
</style>
