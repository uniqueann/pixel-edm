import { z } from "zod";

export const campaignVariableFields = [
  { key: "store_name", label: "店铺名称" },
  { key: "sender_name", label: "发件人" },
  { key: "discount", label: "优惠信息" },
  { key: "product", label: "商品名称" },
  { key: "order_number", label: "订单号" },
] as const;

export type CampaignVariableKey =
  (typeof campaignVariableFields)[number]["key"];
export type CampaignVariables = Partial<Record<CampaignVariableKey, string>>;

export const campaignVariablesInput = z
  .object({
    store_name: z.string().max(200, "店铺名称最多 200 字").optional(),
    sender_name: z.string().max(200, "发件人最多 200 字").optional(),
    discount: z.string().max(200, "优惠信息最多 200 字").optional(),
    product: z.string().max(200, "商品名称最多 200 字").optional(),
    order_number: z.string().max(200, "订单号最多 200 字").optional(),
  })
  .strict("活动包含未知变量")
  .default({});

export const campaignInput = z
  .object({
    workspace_id: z.string().uuid(),
    id: z.string().uuid().optional(),
    expected_version: z.number().int().positive().optional(),
    name: z.string().trim().min(1, "请输入活动名称").max(100),
    template_id: z.string().uuid("请选择有效模板"),
    audience_type: z.enum(["all", "tag"]),
    tag_id: z.string().uuid("请选择有效标签").nullable().optional(),
    variables: campaignVariablesInput,
  })
  .superRefine((value, context) => {
    if (value.id && value.expected_version === undefined) {
      context.addIssue({
        code: "custom",
        path: ["expected_version"],
        message: "缺少活动版本，请重新加载后重试",
      });
    }
    if (value.audience_type === "all" && value.tag_id) {
      context.addIssue({
        code: "custom",
        path: ["tag_id"],
        message: "全部客户活动不能指定标签",
      });
    }
    if (value.audience_type === "tag" && !value.tag_id) {
      context.addIssue({
        code: "custom",
        path: ["tag_id"],
        message: "请选择客户标签",
      });
    }
  });

export type CampaignStatus =
  | "draft"
  | "queued"
  | "sending"
  | "completed"
  | "completed_with_errors"
  | "failed";

export type CampaignSummary = {
  id: string;
  workspace_id: string;
  name: string;
  template_id: string;
  template_name: string;
  template_category: string;
  template_archived: boolean;
  audience_type: "all" | "tag";
  tag_id: string | null;
  tag_name: string | null;
  status: CampaignStatus;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
  created_by: string;
  created_by_name: string;
  version: number;
};

export type CampaignList = {
  items: CampaignSummary[];
  total: number;
  page: number;
  page_size: number;
};

export type CampaignDetail = {
  id: string;
  workspace_id: string;
  name: string;
  template_id: string;
  template: {
    id: string;
    name: string;
    category: string;
    subject: string;
    body: string;
    version: number;
    archived_at: string | null;
  };
  audience_type: "all" | "tag";
  tag_id: string | null;
  tag: { id: string; name: string } | null;
  variables: CampaignVariables;
  status: CampaignStatus;
  archived_at: string | null;
  created_by: string;
  updated_by: string;
  created_at: string;
  updated_at: string;
  version: number;
};
