import {
  ArrowRight,
  Cable,
  Cpu,
  Plus,
  Radio,
  Sparkles,
  Terminal,
  Waypoints,
} from 'lucide-react';
import { useAppStore } from '../store';

const FEATURES = [
  {
    icon: Cable,
    title: '本地端口直连',
    description: '上位机照常连 127.0.0.1，不用改网络拓扑，也不用等内网穿透恢复。',
  },
  {
    icon: Waypoints,
    title: '自定义帧与 CRC',
    description: '魔数、长度字段、大小端、BCD、校验和都用 YAML 描述；复杂协议可在后续版本用 JS 钩子扩展。',
  },
  {
    icon: Radio,
    title: '实时报文与状态',
    description: '收发的每一帧都能看到 hex 和解码字段，设备状态与连接实时同步。',
  },
];

export function Welcome({ onNew }: { onNew: (presetFile?: string) => void }) {
  const presets = useAppStore((state) => state.presets);

  return (
    <div className="relative h-full overflow-y-auto">
      <div className="grid-bg pointer-events-none absolute inset-0 opacity-40" />
      <div className="hero-glow pointer-events-none absolute inset-x-0 top-0 h-[460px]" />

      <div className="relative mx-auto max-w-5xl px-5 py-12 sm:px-8 lg:py-20">
        <div className="inline-flex items-center gap-2 rounded-full border border-accent-500/20 bg-accent-500/[0.07] px-3 py-1 text-xs text-accent-300">
          <Sparkles className="h-3.5 w-3.5" />
          本地优先 · 无需内网穿透
        </div>

        <h1 className="mt-5 max-w-3xl text-3xl font-semibold leading-[1.2] tracking-tight text-mist-100 sm:text-4xl lg:text-[44px]">
          不用等设备，
          <br className="hidden sm:block" />
          也能把联调做完。
        </h1>
        <p className="mt-4 max-w-2xl text-sm leading-7 text-mist-400 sm:text-[15px]">
          DeviceForge 在你的电脑上模拟物联网硬件：自定义帧、请求响应、周期上报和实时报文，
          全部用配置描述、可复现。硬件掉线或穿透中断时，开发不再被卡住。
        </p>

        <div className="mt-7 flex flex-wrap items-center gap-3">
          <button className="btn btn-primary px-4 py-2" onClick={() => onNew()}>
            <Plus className="h-4 w-4" />
            新建设备
          </button>
          <a className="btn btn-outline px-4 py-2" href="#presets">
            浏览预设
            <ArrowRight className="h-4 w-4" />
          </a>
        </div>

        <div className="mt-10 grid gap-3 sm:grid-cols-3">
          {FEATURES.map((feature) => {
            const Icon = feature.icon;
            return (
              <div
                key={feature.title}
                className="panel px-4 py-4 transition-colors hover:border-white/20"
              >
                <div className="flex h-8 w-8 items-center justify-center rounded-lg border border-white/10 bg-white/[0.03]">
                  <Icon className="h-4 w-4 text-accent-400" />
                </div>
                <h3 className="mt-3 text-sm font-medium text-mist-100">{feature.title}</h3>
                <p className="mt-1.5 text-xs leading-5 text-mist-500">{feature.description}</p>
              </div>
            );
          })}
        </div>

        <div className="mt-8 flex flex-wrap items-center gap-2 text-[11px] text-mist-500">
          <span className="chip border-accent-500/20 text-accent-300">
            <Terminal className="h-3 w-3" /> TCP 自定义帧（已支持）
          </span>
          <span className="chip opacity-70">
            <Radio className="h-3 w-3 text-sky-400" /> MQTT · 规划中
          </span>
          <span className="chip opacity-70">
            <Cpu className="h-3 w-3 text-violet-400" /> Modbus · 规划中
          </span>
          <span className="chip opacity-70">HTTP / WebSocket · 规划中</span>
          <span className="text-mist-500">v0.1 先交付 TCP 自定义帧核心</span>
        </div>

        <section id="presets" className="mt-14 scroll-mt-6">
          <div className="flex items-end justify-between">
            <div>
              <h2 className="text-lg font-semibold text-mist-100">从预设开始</h2>
              <p className="mt-1 text-xs text-mist-500">
                预设只是起点，选中后可以继续修改 YAML。
              </p>
            </div>
            <span className="hidden text-[11px] text-mist-500 sm:block">
              {presets.length} 个内置预设
            </span>
          </div>

          <div className="mt-4 grid gap-3 md:grid-cols-3">
            {presets.length === 0 ? (
              <>
                {[0, 1, 2].map((index) => (
                  <div
                    key={index}
                    className="h-36 animate-pulse rounded-xl border border-white/5 bg-white/[0.02]"
                  />
                ))}
              </>
            ) : (
              presets.map((preset) => (
                <button
                  key={preset.file}
                  className="panel group flex flex-col items-start px-4 py-4 text-left transition-colors hover:border-accent-500/30 hover:bg-ink-850"
                  onClick={() => onNew(preset.file)}
                >
                  <div className="flex w-full items-center justify-between gap-2">
                    <span className="chip font-mono text-[10px]">
                      TCP :{preset.config.transport.port}
                    </span>
                    <ArrowRight className="h-4 w-4 text-mist-500 transition-transform group-hover:translate-x-0.5 group-hover:text-accent-400" />
                  </div>
                  <h3 className="mt-3 text-sm font-medium text-mist-100">{preset.name}</h3>
                  <p className="mt-1.5 line-clamp-3 text-xs leading-5 text-mist-500">
                    {preset.description}
                  </p>
                </button>
              ))
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
