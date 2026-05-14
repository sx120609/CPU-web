import { defineStore } from "pinia";
import { messageApi } from "@/api/message";

export const useMessageStore = defineStore("message", {
  state: () => ({ unreadCount: 0 }),
  actions: {
    async refresh() {
      try {
        const list = await messageApi.list();
        this.unreadCount = list.filter((n: any) => !n.readAt).length;
      } catch { /* ignore */ }
    },
  },
});
