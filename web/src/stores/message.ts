import { defineStore } from "pinia";
import { messageApi } from "@/api/message";

export type MessageNotice = {
  id: number;
  category?: string;
  title?: string;
  content?: string;
  link?: string | null;
  payload?: Record<string, unknown>;
  readAt?: string | null;
  createdAt?: string;
};

export const useMessageStore = defineStore("message", {
  state: () => ({
    unreadCount: 0,
    directUnreadCount: 0,
    latestDirectNotice: null as MessageNotice | null,
  }),
  actions: {
    async refresh() {
      try {
        const list = await messageApi.list() as MessageNotice[];
        this.setNotices(list);
      } catch { /* ignore */ }
    },
    setNotices(list: MessageNotice[]) {
      const unread = list.filter((notice) => !notice.readAt);
      const directUnread = unread
        .filter((notice) => notice.category === "direct-message")
        .sort((a, b) => {
          const timeDelta = new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime();
          return timeDelta || b.id - a.id;
        });
      this.unreadCount = unread.length;
      this.directUnreadCount = directUnread.length;
      this.latestDirectNotice = directUnread[0] || null;
    },
  },
});
