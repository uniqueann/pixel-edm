import Image from "next/image";
import Link from "next/link";
import { ArrowUpRight, CheckCircle2, ExternalLink } from "lucide-react";

type GuideStep = {
  number: string;
  title: string;
  place: string;
  description: string;
  actions: string[];
  done: string;
  reference?: { label: string; href: string };
  illustration?: {
    src: string;
    alt: string;
    caption: string;
    width: number;
    height: number;
  };
};

const requiredSteps: GuideStep[] = [
  {
    number: "01",
    title: "开通邮件推送服务",
    place: "阿里云",
    description:
      "准备可管理 DNS 的自有域名，以及已完成阿里云账号认证的管理员。邮件推送需要单独开通；计费方式以阿里云当前页面为准。",
    actions: [
      "进入阿里云「邮件推送 DirectMail」产品页，申请开通服务。",
      "记下使用的区域；后续域名、发件地址、站内通道与 EventBridge 都要选同一区域。",
    ],
    done: "可以打开该区域的邮件推送控制台。",
    reference: {
      label: "阿里云：开通邮件推送",
      href: "https://help.aliyun.com/zh/direct-mail/purchase-procedure",
    },
  },
  {
    number: "02",
    title: "添加发件域名并验证 DNS",
    place: "阿里云 + 域名服务商",
    description:
      "建议使用自有子域名，例如 send.example.com；它只是示例，请换成你有权管理的域名。",
    actions: [
      "邮件推送控制台 → 发信域名 → 新建域名，打开该域名的「配置」页。",
      "在域名服务商的 DNS 页面，逐项填写控制台给出的所有权、SPF、DKIM、DMARC、MX 等记录。记录名和值以你的控制台为准，不要复制别人的解析值。",
      "等待 DNS 生效后，返回邮件推送控制台点击「验证」。",
    ],
    done: "发信域名显示「验证通过」；新域名所需记录均通过校验。",
    reference: {
      label: "阿里云：设置发信域名",
      href: "https://help.aliyun.com/zh/direct-mail/user-guide/how-to-configure-sending-domain-names",
    },
    illustration: {
      src: "/help/directmail-dns.svg",
      alt: "发信子域名的 DNS 记录从阿里云控制台复制到域名服务商，并返回阿里云验证的流程示意图",
      caption:
        "域名验证示意。图中仅展示记录种类，实际主机名和值由阿里云控制台生成。",
      width: 960,
      height: 300,
    },
  },
  {
    number: "03",
    title: "创建发信地址",
    place: "阿里云",
    description:
      "在已验证域名下创建真正用来发信的地址，例如 hello@send.example.com。",
    actions: [
      "邮件推送控制台 → 发信地址 → 新建发信地址，选择刚验证的域名。",
      "如需接收客户回复，设置并验证回信地址；它可以与发信地址不同。",
      "新建后按阿里云提示等待地址可用，再进行站内测试。",
    ],
    done: "发信地址在该区域的控制台可见，且对应域名已验证。",
    reference: {
      label: "阿里云：设置发信地址",
      href: "https://help.aliyun.com/zh/direct-mail/user-guide/setup-sender-addresses",
    },
  },
  {
    number: "04",
    title: "创建专用 RAM 访问密钥",
    place: "阿里云 RAM",
    description:
      "为邮局单独创建可调用邮件发送 API 的 RAM 身份，并生成 AccessKey ID 与 AccessKey Secret。",
    actions: [
      "给该 RAM 身份授予发送所需权限；阿里云提供只允许 dm:SingleSendMail 的自定义策略示例。",
      "把新生成的 ID 与 Secret 暂存于安全位置，下一步在本站配置框中填写。Secret 后续不会在本站回显。",
    ],
    done: "拿到一对有效的 AccessKey，并确认它属于当前发信账号。",
    reference: {
      label: "阿里云：RAM 授权示例",
      href: "https://help.aliyun.com/zh/direct-mail/use-ram-users-to-perform-access-control-on-resources",
    },
  },
  {
    number: "05",
    title: "在卖家邮局连接通道",
    place: "本站 · 管理员",
    description:
      "进入「设置 → 发信通道 → 添加 阿里云邮件推送」。以下字段须与阿里云已验证的信息一致。",
    actions: [
      "区域：选择域名和发信地址所在区域；发件域名、发件地址：填你自己的值。",
      "发件人名称：最多 14 个字符；回复地址可选，填写时应是你能收信的地址。",
      "填入 RAM AccessKey ID 与 Secret，点击「安全保存配置」。先在「店铺信息」保存工作区联系地址。",
    ],
    done: "通道卡片出现，状态为「已配置，待验证」。",
  },
  {
    number: "06",
    title: "发送第一封测试邮件",
    place: "本站 · 管理员",
    description:
      "在通道卡片上点击「发送测试邮件」。本站会发往当前登录管理员自己的已验证邮箱。",
    actions: [
      "检查收件箱和垃圾邮件箱，确认发件地址、名称和回复地址符合预期。",
      "若失败，先核对区域、RAM 权限、发信地址状态，再看通道卡片的错误提示。",
    ],
    done: "收到真实测试信，通道显示「已验证」。",
  },
];

const advancedSteps: GuideStep[] = [
  {
    number: "07",
    title: "开启打开与点击追踪（可选）",
    place: "阿里云 + 本站",
    description:
      "先在阿里云「邮件标签」中新建标签，再在通道卡片的「打开与点击追踪」中启用并填入完全相同的标签名。",
    actions: [
      "标签须真实存在，且使用当前邮件推送账号与区域；本站只接受字母、数字和下划线。",
      "保存后仅影响未来正式活动；打开统计受邮箱客户端图片加载方式影响，点击统计需要邮件里有可访问的 HTTP(S) 链接。",
      "本站发送 HTML 追踪邮件，并把退订链接排除在点击统计之外。",
    ],
    done: "通道卡片显示「已开启 · 标签名」。",
    reference: {
      label: "阿里云：打开与点击追踪",
      href: "https://help.aliyun.com/zh/direct-mail/how-do-i-enable-the-data-tracking-feature",
    },
  },
  {
    number: "08",
    title: "接入投递回执 Webhook（推荐）",
    place: "本站 + EventBridge",
    description:
      "回执让活动区分「供应商已受理」和「收件服务器已送达」，也能同步退信、投诉与行为事件。",
    actions: [
      "本站通道卡片 → 投递回执 Webhook →「生成令牌」，立即复制 HTTPS 目标地址与只显示一次的令牌。",
      "阿里云邮件推送控制台开启「事件分发」；在同一区域的 EventBridge 云服务专用事件总线上创建规则。展开本站通道卡片的「EventBridge 事件规则」，按其中模式配置事件源 acs.dm 与七类事件。",
      "目标选 HTTP/HTTPS，URL 填本站复制的完整 HTTPS 地址，消息体选「完整事件」；展开高级选项，将令牌填入 Token。生产规则配置重试与 MNS 死信队列。",
      "保存后核对目标 URL 中的 channel_id 与当前通道一致。轮换令牌时也要同步修改规则的 Token。",
    ],
    done: "小流量正式发送后，通道显示最近回执，活动统计从「等待回执」更新为实际送达或失败。",
    reference: {
      label: "阿里云：邮件推送事件分发",
      href: "https://help.aliyun.com/zh/direct-mail/user-guide/set-up-eventbridge",
    },
    illustration: {
      src: "/help/directmail-receipts.svg",
      alt: "DirectMail 发送后由 EventBridge 将签名事件投递到当前通道的 Webhook，再更新活动统计的流程示意图",
      caption: "回执链路示意。每个工作区通道使用自己的目标地址与令牌。",
      width: 960,
      height: 300,
    },
  },
];

function StepCard({ step }: { step: GuideStep }) {
  return (
    <li className="list-none rounded-2xl border bg-card p-5 shadow-sm sm:p-6">
      <article aria-labelledby={`directmail-step-${step.number}`}>
        <div className="flex items-start gap-4">
          <span
            className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary font-mono text-sm font-semibold text-primary-foreground"
            aria-hidden="true"
          >
            {step.number}
          </span>
          <div className="min-w-0 flex-1">
            <p className="m-0 text-xs font-semibold tracking-wide text-muted-foreground">
              {step.place}
            </p>
            <h3
              id={`directmail-step-${step.number}`}
              className="mt-1 mb-2 text-lg"
            >
              {step.title}
            </h3>
            <p className="m-0 text-sm leading-7">{step.description}</p>
          </div>
        </div>

        <ol className="mt-4 mb-0 list-decimal space-y-2 pl-6 text-sm leading-7">
          {step.actions.map((action) => (
            <li key={action}>{action}</li>
          ))}
        </ol>

        {step.illustration && (
          <figure className="mt-5 mb-0">
            <div className="overflow-x-auto rounded-xl border bg-[#f8f8f4]">
              <Image
                src={step.illustration.src}
                width={step.illustration.width}
                height={step.illustration.height}
                alt={step.illustration.alt}
                className="h-auto min-w-[680px]"
              />
            </div>
            <figcaption className="mt-2 text-xs text-muted-foreground">
              {step.illustration.caption}
            </figcaption>
          </figure>
        )}

        <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t pt-4">
          <p className="m-0 flex items-start gap-2 text-sm text-[#2f6e52]">
            <CheckCircle2
              className="mt-0.5 size-4 shrink-0"
              aria-hidden="true"
            />
            <span>完成标志：{step.done}</span>
          </p>
          {step.reference && (
            <a
              href={step.reference.href}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-sm underline underline-offset-2"
            >
              {step.reference.label}
              <ExternalLink className="size-3.5" aria-hidden="true" />
            </a>
          )}
        </div>
      </article>
    </li>
  );
}

export function DirectMailSetupGuide() {
  return (
    <section id="help-directmail-setup" className="scroll-mt-24 space-y-6">
      <div className="overflow-hidden rounded-2xl bg-primary px-5 py-7 text-primary-foreground sm:px-8">
        <p className="m-0 text-xs font-semibold tracking-[0.18em] text-white/70">
          从零开通 · 图文教程
        </p>
        <h2 className="mt-2 mb-2 text-2xl text-white">
          阿里云 DirectMail 发信配置
        </h2>
        <p className="m-0 max-w-2xl text-sm leading-7 text-white/85">
          按顺序完成阿里云账号、域名、密钥和站内测试；需要活动送达与行为统计时，再接入追踪与回执。
        </p>
        <div className="mt-5 flex flex-wrap gap-2 text-xs">
          {[
            "开通服务",
            "验证域名",
            "创建地址",
            "RAM 密钥",
            "站内连接",
            "测试发送",
            "追踪与回执",
          ].map((label, index) => (
            <span
              key={label}
              className="rounded-full border border-white/25 px-3 py-1.5 text-white/90"
            >
              {index + 1}. {label}
            </span>
          ))}
        </div>
      </div>

      <div className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm leading-7 text-amber-950 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-100">
        请使用你自己的阿里云账号和发件域名。图中的域名是示例，DNS
        解析值须从你的阿里云控制台复制；AccessKey 和 Webhook
        令牌只填入对应的安全配置框。
      </div>

      <div>
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <h3 className="m-0 text-lg">第一段：开通并发出测试信</h3>
          <span className="rounded-full bg-[#eaf3ed] px-3 py-1 text-xs text-[#2f6e52]">
            必做 · 步骤 01—06
          </span>
        </div>
        <ol className="m-0 grid gap-4 p-0">
          {requiredSteps.map((step) => (
            <StepCard key={step.number} step={step} />
          ))}
        </ol>
      </div>

      <div>
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <h3 className="m-0 text-lg">第二段：让活动统计有真实回执</h3>
          <span className="rounded-full bg-muted px-3 py-1 text-xs">
            按需配置 · 步骤 07—08
          </span>
        </div>
        <ol className="m-0 grid gap-4 p-0">
          {advancedSteps.map((step) => (
            <StepCard key={step.number} step={step} />
          ))}
        </ol>
      </div>

      <div className="rounded-2xl border bg-card p-5 sm:p-6">
        <h3 className="mt-0 mb-3 text-lg">最后：用小名单验收</h3>
        <ol className="m-0 list-decimal space-y-2 pl-5 text-sm leading-7">
          <li>只添加已同意收信的 1—3 个自有测试地址，创建、预览并确认活动。</li>
          <li>
            管理员开始正式发送；先看到「已受理」，有回执后再核对「已送达」。
          </li>
          <li>
            已开启追踪时，用邮箱打开图片并点击正文的普通链接，查看打开与点击统计。
          </li>
          <li>
            用邮件页脚的退订链接完成一次确认，再检查该地址被排除于新活动受众。
          </li>
        </ol>
        <div className="mt-5 flex flex-wrap gap-3">
          <Link
            href="/settings"
            className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
          >
            前往发信通道设置{" "}
            <ArrowUpRight className="size-4" aria-hidden="true" />
          </Link>
          <a
            href="https://help.aliyun.com/zh/eventbridge/user-guide/events-of-the-direct-mail-type"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 px-1 py-2 text-sm underline underline-offset-2"
          >
            查看阿里云事件类型{" "}
            <ExternalLink className="size-3.5" aria-hidden="true" />
          </a>
        </div>
      </div>
    </section>
  );
}
