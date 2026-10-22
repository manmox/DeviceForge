# DeviceForge

本地运行的物联网设备仿真工作台。用配置描述设备行为，在本机端口模拟硬件，让上位机照常连接——设备掉线、内网穿透中断时，联调仍然可以继续。

> **当前版本 v0.1**：完成 TCP 自定义帧核心、声明式编解码、规则引擎和实时报文控制台。UDP、串口、MQTT、HTTP/WebSocket、Modbus 和录制回放/故障注入在后续里程碑中实现。

## 为什么做这个

物联网开发通常依赖厂商硬件，而设备在内网，需要穿透才能访问。穿透通道不稳定、设备偶尔掉线，都会让联调停摆。DeviceForge 把设备侧的行为搬到本地：

- **不用改上位机网络配置**：设备监听 `127.0.0.1:端口`，上位机连本地即可。
- **自定义协议可描述**：魔数、长度字段、字节序、BCD、校验和、请求响应和周期上报都用 YAML 表达。
- **行为可复现**：同一份配置可以反复启动、停止、重启，状态和报文实时可见。
- **后续可回放**：透明代理、录制回放和故障注入会把“偶发掉线”变成可回归的测试场景。

## v0.1 已实现

- TCP server 设备（监听本机端口，支持多客户端连接）
- 分帧：`raw`、`delimiter`、`length-prefix`、`fixed`
- 编解码：`raw`（hex/ascii）和声明式 `fields`
- 字段：`u8/i8/u16/i16/u24/i24/u32/i32/f32/f64`、`bytes`、`string`、`bcd`
- 校验：`sum8`、`xor8`、`crc8`、`crc16-modbus`、`crc16-ccitt`、`crc32`、`lrc`
- 规则：上线发送、收到匹配帧后响应、按周期上报、更新状态变量
- 模板：请求字段、设备状态、计数器、连接信息和随机数
- 设备信息：可选的厂商、型号、S/N、硬件/固件版本和厂商自定义 TNS/IMEI 元数据
- Web 控制台：设备列表、可视化表单 / YAML 双模式配置、实时报文、hex dump、解码字段、手动发送、连接管理、状态查看
- 配置持久化到 `data/devices.json`；报文和运行时状态保存在内存
- 内置 3 个预设，分别展示行协议、TCP 回显和传感器数据

## 快速开始

要求：Node.js >= 22.12（推荐 24.x）、pnpm 11.x。

```bash
pnpm install
pnpm dev
```

打开 <http://127.0.0.1:5173>。开发模式下：

- 前端：Vite `5173`，代理 `/api` 和 `/ws` 到后端
- 控制面：Fastify `127.0.0.1:7321`
- 模拟设备端口：由设备配置决定（预设使用 `19001`、`19002`、`19003`）

生产模式：

```bash
pnpm build
pnpm start
```

打开 <http://127.0.0.1:7321>。

## 5 分钟演示

1. 点击「新建设备」→ 选择「厂商温湿度传感器」→「校验配置」→「创建设备」。
2. 回到设备页，点击「启动」。端点应为 `127.0.0.1:19001`。
3. 另开终端运行演示客户端：

   ```bash
   pnpm demo:client 127.0.0.1 19001 7
   ```

4. 客户端会先收到上线握手，再收到读取温湿度的响应；控制台的「流量」页会实时显示接收/发送帧、解码字段和 CRC 校验结果。

演示客户端位于 `scripts/send-demo.ts`，它读取 `presets/vendor-sensor.yaml` 的 codec/framing 来编码请求。

## 设备配置

配置用 YAML 编写，服务端用 Zod 校验。示例：

```yaml
id: vendor-sensor
name: 厂商温湿度传感器
description: AA55 魔数 + 总长度字段 + CRC16/MODBUS
deviceInfo:
  manufacturer: DeviceForge Demo
  model: DF-TH100
  serialNumber: DEMO-SN-0001
  hardwareVersion: HW-1.0
  firmwareVersion: FW-1.0.3
  tnsImei: DEMO-TNS-0001

transport:
  type: tcp-server
  host: 127.0.0.1
  port: 19001

framing:
  type: length-prefix
  lengthField:
    offset: 2      # 长度字段在帧内的偏移
    size: 2        # 1 / 2 / 4
    endian: be
    adjust: 0      # 实际帧长 = 字段值 + adjust
  maxFrameLength: 4096

codec:
  type: fields
  fields:
    - { name: magic, type: bytes, length: 2, const: "AA55" }
    - { name: length, type: u16, endian: be, calc: totalLength }
    - { name: cmd, type: u8 }
    - { name: seq, type: u16, endian: le }
    - { name: temp, type: i16, endian: be, scale: 0.1, unit: "℃" }
    - { name: humidity, type: u8, unit: "%" }
  checksum: { algo: crc16-modbus, endian: le }

state:
  temp: 25.5
  humidity: 60

rules:
  - name: 上线握手
    on: connect
    send:
      fields: { cmd: 1, seq: 0, temp: 0, humidity: 0 }

  - name: 读取温湿度
    on: frame
    match: { cmd: 3 }
    send:
      fields:
        cmd: 131
        seq: "$req.seq"
        temp: "$state.temp"
        humidity: "$state.humidity"

  - name: 周期上报
    every: 5000
    jitter: 200
    target: all
    set:
      temp: "${randomFloat(20,30)}"
      humidity: "${random(40,70)}"
    send:
      fields:
        cmd: 2
        seq: "$counter.tx"
        temp: "$state.temp"
        humidity: "$state.humidity"

autoStart: false
```

这个配置生成的帧是 12 字节：

```text
AA 55 | 00 0C | 03 | 01 00 | 00 FA | 3C | CRC16(2)
magic | 总长  | cmd | seq  | temp  | 湿度 | 低字节在前
```

- `magic` 是常量，`length` 由 `calc: totalLength` 自动计算。
- 响应规则只需要提供 `cmd/seq/temp/humidity`，常量、长度和 CRC 由 codec 补齐。
- **Framer 只负责入站分帧**；出站帧由 codec 完整编码，避免两套长度/校验定义冲突。

### 分帧方式

| `framing.type` | 说明 |
| --- | --- |
| `raw` | 每个 TCP 数据块当作一帧；适合已经按消息边界读取的场景，或在 `tcp-echo` 预设中观察原始数据 |
| `delimiter` | 按十六进制分隔符切分，例如 CRLF 是 `"0D0A"`；`includeDelimiter` 控制是否保留分隔符 |
| `length-prefix` | 从指定偏移读取 1/2/4 字节长度，`adjust` 用于修正“长度是否包含头/CRC” |
| `fixed` | 固定帧长，不足时等待后续数据 |

### 字段选项

| 选项 | 说明 |
| --- | --- |
| `endian` | `be`（默认）或 `le` |
| `length` | `bytes/string/bcd` 必填；可以是固定字节数、`remaining`（剩余全部），或 `{ fromField: "len" }` |
| `encoding` | `string` 字段使用 `ascii`、`utf8` 或 `hex` |
| `calc` | 数值字段自动计算：`totalLength`（整帧长度）或 `remainingLength`（本字段之后的字节数） |
| `const` | 常量；编码时未提供就使用它，解码时不一致会产生 warning |
| `scale` | 原始值 × scale 得到业务值；编码时业务值 ÷ scale 后取整 |
| `unit` | 仅用于展示 |

### 校验

`checksum.algo` 支持 `sum8`、`xor8`、`crc8`、`crc16-modbus`、`crc16-ccitt`、`crc32`、`lrc`，默认写在帧尾、覆盖校验字段之前的全部字节。`endian` 默认值：CRC16/MODBUS 和 CRC32 为 `le`，其余为 `be`；可用 `verify: false` 只展示不阻断规则。

### 设备信息（可选）

`deviceInfo` 用于记录真实硬件铭牌上的身份信息，所有字段可选；没有填写时不会出现在 YAML/JSON 中。

| 字段 | 说明 |
| --- | --- |
| `manufacturer` | 制造商 |
| `model` | 型号 |
| `serialNumber` | 厂商序列号（S/N），用于资产/供应链追踪 |
| `hardwareVersion` | 硬件版本 |
| `firmwareVersion` | 固件版本 |
| `tnsImei` | 厂商自定义的 TNS/IMEI 标识，不是标准字段 |

- `id` 是 DeviceForge 的平台注册键，和厂商 S/N 相互独立。
- `serialNumber` 不是认证凭据；需要认证时应使用独立的密钥/证书配置。
- `tnsImei` 是单个不透明字符串，不做 IMEI/TNS 格式校验，也不强制唯一。
- 这些字段目前只保存和展示，不参与分帧、编解码、规则、模板、流量日志或协议发送。
- 字段命名参考 LwM2M Device Object、OPC UA DI 等模型中的 Manufacturer/Model/SerialNumber 概念，不是某个具体协议的线格式。

## 规则与模板

规则触发方式：

- `on: start`：设备启动后执行一次
- `on: connect`：每个客户端连接时执行
- `on: frame` + `match`：收到匹配的帧时执行；不写 `match` 表示匹配所有帧
- `every: 毫秒`：周期执行，可配 `jitter`；`target: all | last` 控制广播还是发给最近连接

`set` 在发送前更新设备状态。`send` 可以是单个消息或消息数组；`disconnect: true` 会在发送后断开当前连接。

匹配值支持字面量，也支持：

```yaml
match:
  cmd: { $in: [1, 3] }
  seq: { $ne: 0 }
  payload: { $exists: true }
  name: { $regex: "^sensor-" }
```

模板表达式：

| 写法 | 含义 |
| --- | --- |
| `$req.seq` | 触发帧的解码字段 |
| `$state.temp` | 设备状态变量 |
| `$counter.tx` / `$counter.rx` | 已发送/已接收帧计数（读取当前值，发送后递增） |
| `$conn.remoteAddress` | 当前连接信息 |
| `$now` | 当前时间戳（毫秒） |
| `${random(20,30)}` | 闭区间随机整数 |
| `${randomFloat(20,30)}` | 保留两位小数的随机浮点数 |
| `${and(state.online, state.temp > 20)}` | 逻辑与；还支持 `or`/`not`、`&&`/`||`/`!` |
| `${state.temp + 1}` | 算术；支持 `+ - * / %`、比较和括号 |
| `seq=${req.seq}` | 字符串插值；`${...}` 内可以写 `req.*`、`state.*`、`counter.*`、`conn.*` |

- `${...}` 支持数字/字符串/布尔/null、路径、括号，以及 `random`、`randomFloat`、`and`、`or`、`not`；运算符包括 `+ - * / %`、`== != < <= > >=`、`&& || !`。
- `==`/`!=` 是严格相等；关系比较只接受两个数字或两个字符串（字符串按 JS 顺序比较），算术只接受有限数字；真值判断同 JS。
- 整个值写成 `"$req.seq"` 或 `"${random(20,30)}"` 时会保留原始类型（数字/布尔），不会转成字符串；混合文本插值会转成字符串。
- `$req` 只在 `on: frame` 规则中可用；`$conn` 在 `set` 中仅 `connect`/`frame` 可用，在 `send` 和手动发送中可用；手动发送没有 `$req`。
- `$now` 是叶子，不能写 `$now.x`；路径只读取自有属性，`__proto__`、`constructor`、`prototype` 不可访问。
- 状态键/字段名目前只支持 ASCII 标识符路径；带空格、点号、连字符或中文的键不能通过点路径引用。

可视化表单中的模板值支持补全：输入 `$` 或 `${` 会弹出变量/函数建议，附带类型或简短说明，支持方向键、Home/End、Enter/Tab 选择和 Esc 关闭，`Ctrl+Space` 可重新打开。数字字段输入 `$` 会自动转为表达式；布尔/null 字段可用 `fx` 按钮。补全中的 `state.*` 键来自当前配置的初始状态，运行时由规则新增的键不会自动出现在建议中。源码模式不提供补全。

## 可视化配置

设备配置、初始状态、运行时状态和手动发送字段都支持「可视化 / 源码」切换：

- **设备配置**：基本信息、设备信息、传输、分帧、字段编解码、校验和、初始状态、规则（触发/匹配/set/send）全部表单化。
- **分区导航与摘要行**：左侧（窄屏为顶部）按分区切换，一次只显示一节；字段和规则默认折叠为一行摘要，按需展开。校验失败时会跳到第一个问题分区并展开对应条目。
- **状态与发送字段**：键值表 + 类型选择，支持字符串、数字、布尔、null、对象和数组；复杂结构可以切到 JSON 源码。
- **模板补全**：规则 `set`、`send.fields` 和手动发送字段输入 `$`/`${` 时显示变量/函数建议；数字字段可用 `$` 或 `fx` 转为表达式，布尔/null 用 `fx`。源码模式没有补全。
- **默认可视化**：每个编辑面分别记住上次选择（localStorage）；源码模式始终保留作为兜底。
- **服务端校验**：源码切回可视化时会先调用 `POST /api/config/validate`，失败则留在源码模式并展示问题；可视化保存前同样经过服务端 Zod 校验。
- **注释**：可视化编辑后重新生成 YAML 会丢失注释；配置本身由服务端以 JSON 持久化，YAML 注释也不会跨保存/重载保留。
- **状态保存**：保存会替换整个状态对象，便于删除键；编辑期间规则产生的其他状态更新会被当前草稿覆盖。

## 项目结构

```text
packages/core      设备引擎：schema、framing、codec、checksum、rules、runtime、TCP transport
packages/server    Fastify REST + WebSocket + JSON 持久化 + 静态托管
packages/web       React + Vite + Tailwind 控制台
presets/           内置 YAML 预设
scripts/           演示客户端
packages/core/src/__tests__/  单元测试和 TCP 集成测试
```

`packages/core` 不依赖 HTTP/UI，可以直接在测试或 CI 中 `new DeviceRuntime(config)` 使用。

## 开发与测试

```bash
pnpm -r typecheck    # 三个包的类型检查
pnpm test            # 核心测试 + Web 纯函数测试
pnpm build           # 类型检查 + 构建前端
pnpm dev             # server + Vite
pnpm start           # 生产模式（需要先 build）
```

测试覆盖：

- CRC/校验和已知向量（CRC16/MODBUS `123456789 → 0x4B37` 等）
- length-prefix 半包、粘包、多帧、超长帧
- delimiter、fixed、raw 分帧
- 字段编解码回环、CRC 校验失败、固定长度/剩余长度/fromField
- 模板求值（路径、算术、比较、布尔函数、插值扫描、错误和限制）、模板补全 token/候选/插入，以及字段匹配
- 真实 `node:net` 客户端连 TCP 设备：握手、请求响应、手动发送、错误 CRC 不触发规则
- 设备信息 `deviceInfo` 的 schema 解析和 Web 端元数据归一化/摘要
- Web 端配置默认值、YAML/JSON 序列化、JSON 值编辑、规则触发/send/match 转换的纯函数测试

本地文档统一放在 `docs/`；该目录已加入 `.gitignore`，不会进入版本库。

## 环境变量

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `DEVICEFORGE_PORT` | `7321` | 控制面端口 |
| `DEVICEFORGE_HOST` | `127.0.0.1` | 控制面绑定地址 |
| `DEVICEFORGE_DATA_DIR` | `<repo>/data` | 设备配置存储目录 |
| `LOG_LEVEL` | `info` | Fastify/Pino 日志级别 |

模拟设备自身监听的地址和端口由设备配置中的 `transport.host/port` 决定，默认只监听本机。

## 路线图

| 里程碑 | 内容 |
| --- | --- |
| **M2 传输扩展** | TCP client（自动重连）、UDP、串口；MQTT broker/client；HTTP server；WebSocket server；虚拟串口（Linux/macOS socat，Windows com0com） |
| **M3 Modbus** | Modbus TCP/RTU slave，FC 01/02/03/04/05/06/15/16，寄存器/线圈表，异常响应 |
| **M4 可靠性** | JS script codec（worker + vm）、故障注入（延迟/丢包/断连/损坏）、透明代理、录制回放、虚拟时钟、多设备场景、CI |
| **更远** | CoAP、OPC UA、BACnet、BLE、pcapng 导出、可视化协议编辑器、Docker 发行 |

## 已知限制

- v0.1 只实现 TCP server transport；UDP、串口、MQTT、HTTP/WebSocket 仍在路线图中。
- 配置会持久化；**报文历史和运行时状态不会跨服务重启保留**。重启后状态回到配置中的 `state`。
- 可视化编辑会重新生成 YAML，源码模式中的注释和原格式只在当前编辑会话、且未做可视化修改时保留；服务端本身只存 JSON。
- 模板补全只在可视化模板输入中提供；YAML/JSON 源码模式没有补全。
- 没有 TLS、认证和多用户；控制面默认只绑定 `127.0.0.1`，不要直接暴露到公网。
- `raw` framing 在 TCP 上把每个数据块当作一帧，不保证与业务消息边界一致；带明确边界的协议请使用 length-prefix/delimiter/fixed。
- JS script codec、录制回放、故障注入尚未实现；当前 UI 中的协议标签已标注“规划中”。

## 设计约定

- **入站分帧、出站编码**：Framer 只拆分字节流，Codec 负责完整帧的编码/解码（含长度、常量、校验）。
- **设备状态是设备级的**：`state` 被所有连接共享；`req/conn/counter` 是请求或连接上下文。
- **规则按顺序执行**：一帧可以命中多条规则；每条规则的 `set` 在发送前生效。
- **HTTP 控制面和模拟数据面分离**：控制面固定在本机端口；模拟设备端口独立配置，互不影响。
