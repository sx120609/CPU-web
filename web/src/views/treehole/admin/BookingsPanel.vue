<template>
  <section class="th-group th-group--flush">
    <div class="th-group-head">
      <h2 class="th-h2">线下倾诉预约记录</h2>
      <el-select v-model="status" size="small" class="th-filter" @change="reload">
        <el-option label="全部" value="all" />
        <el-option label="待确认" value="pending" />
        <el-option label="已确认" value="confirmed" />
        <el-option label="已结束" value="done" />
        <el-option label="已取消" value="cancelled" />
        <el-option label="未接受" value="rejected" />
        <el-option label="已过期" value="expired" />
      </el-select>
    </div>
    <p class="th-sub th-panel-note">只显示预约的虚拟 ID，不显示同学身份。</p>
    <div v-if="!list.length" class="th-empty"><p>没有符合条件的预约。</p></div>
    <div v-else class="th-rows">
      <div v-for="booking in list" :key="booking.id" class="th-row">
        <div class="th-row-copy">
          <div class="th-row-title">
            {{ bookingTimeText(booking.startAt, booking.endAt) }}
            <em class="th-chip" :class="bookingStatusTone(booking.status)">{{ bookingStatusLabel(booking.status) }}</em>
          </div>
          <p class="th-meta">
            <span>{{ booking.host.name }}</span>
            <span>{{ booking.alias }}</span>
            <span>提交于 {{ timeText(booking.createdAt) }}</span>
            <span v-if="booking.cancelledBy">{{ booking.cancelledBy === "host" ? "小艾绒取消" : "同学取消" }}</span>
            <span v-if="booking.rejectReason || booking.cancelReason">{{ booking.rejectReason || booking.cancelReason }}</span>
          </p>
        </div>
      </div>
    </div>
    <div v-if="total > 30" class="th-pager">
      <el-pagination v-model:current-page="page" layout="prev, pager, next" :page-size="30" :total="total" small @current-change="load" />
    </div>
  </section>
</template>

<script setup lang="ts">
import { onMounted, ref } from "vue";
import { treeholeApi, type TreeholeBooking } from "@/api/treehole";
import { bookingStatusLabel, bookingStatusTone, bookingTimeText, timeText } from "../shared";

const status = ref("all");
const list = ref<TreeholeBooking[]>([]);
const total = ref(0);
const page = ref(1);

async function load() {
  const result = await treeholeApi.adminBookings({ status: status.value, page: page.value });
  list.value = result.list;
  total.value = result.total;
}

function reload() {
  page.value = 1;
  void load();
}

onMounted(load);
</script>

<style scoped>
.th-filter { width: 110px; }
.th-panel-note { margin: -6px 16px 8px; }
.th-pager { display: flex; justify-content: center; padding: 8px; border-top: 1px solid var(--cpu-border-soft); }
</style>
