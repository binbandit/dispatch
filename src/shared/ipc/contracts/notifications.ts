export interface NotificationIpcApi {
  "notifications.list": {
    args: { limit?: number };
    result: Array<{
      id: number;
      type: "review" | "ci-fail" | "approve" | "merge";
      title: string;
      body: string;
      prNumber: number;
      workspace: string;
      authorLogin: string;
      read: boolean;
      createdAt: string;
    }>;
  };
  "notifications.markRead": { args: { id: number }; result: void };
  "notifications.markAllRead": { args: void; result: void };
  "notifications.clearRead": { args: void; result: void };
  "notifications.clearAll": { args: void; result: void };
  "notifications.dismiss": { args: { id: number }; result: void };
  "notifications.insert": {
    args: {
      type: "review" | "ci-fail" | "approve" | "merge";
      title: string;
      body: string;
      prNumber: number;
      workspace: string;
      authorLogin?: string;
    };
    result: void;
  };
  "notifications.show": {
    args: {
      type: "review" | "ci-fail" | "approve" | "merge";
      title: string;
      body: string;
      prNumber: number;
      workspace: string;
      authorLogin?: string;
    };
    result: void;
  };
}
