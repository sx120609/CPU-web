<template>
  <VChart :option="option" autoresize />
</template>

<script setup lang="ts">
import { use } from "echarts/core";
import { CanvasRenderer } from "echarts/renderers";
import { LineChart } from "echarts/charts";
import { GridComponent, TooltipComponent } from "echarts/components";
import type { EChartsOption } from "echarts";
import VChart from "vue-echarts";

use([CanvasRenderer, LineChart, GridComponent, TooltipComponent]);

defineProps<{ option: EChartsOption }>();
</script>
