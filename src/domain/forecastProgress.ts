export type ForecastStageId = "base" | "official" | "eot20" | "scoring";

export type ForecastStageStatus = "completed" | "running" | "pending" | "error";

export type ForecastStage = {
  id: ForecastStageId;
  label: string;
  status: ForecastStageStatus;
  detail: string;
};

export type ForecastProgress = {
  requestId: number;
  stages: ForecastStage[];
};

export type ForecastStageUpdate = Pick<ForecastStage, "id" | "status"> & {
  detail?: string;
};

export function createForecastProgress(requestId: number): ForecastProgress {
  return {
    requestId,
    stages: [
      {
        id: "base",
        label: "天气、风浪与安全数据",
        status: "running",
        detail: "正在读取天气、Marine、BOM 警告与实况",
      },
      {
        id: "official",
        label: "官方参考港潮汐",
        status: "pending",
        detail: "等待基础数据完成后匹配参考港",
      },
      {
        id: "eot20",
        label: "EOT20 本地潮汐模型",
        status: "pending",
        detail: "等待确认是否需要运行本地模型",
      },
      {
        id: "scoring",
        label: "最终评分与窗口重算",
        status: "pending",
        detail: "等待潮汐来源确定",
      },
    ],
  };
}

export function updateForecastProgress(
  progress: ForecastProgress,
  updates: ForecastStageUpdate[],
): ForecastProgress {
  const byId = new Map(updates.map((update) => [update.id, update]));
  return {
    ...progress,
    stages: progress.stages.map((stage) => {
      const update = byId.get(stage.id);
      if (!update) return stage;
      return {
        ...stage,
        status: update.status,
        detail: update.detail ?? stage.detail,
      };
    }),
  };
}
