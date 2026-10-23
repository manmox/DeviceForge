# DeviceForge

本地运行的物联网设备仿真工作台。用配置描述设备行为，在本机端口模拟硬件，让上位机照常连接——设备掉线、内网穿透中断时，联调仍然可以继续。

> **当前版本 v0.1**：完成 TCP 自定义帧核心、TCP Server/Client 传输、MQTT Client 与内嵌 Broker、声明式编解码、规则引擎、故障注入、流量录制回看和实时报文控制台。UDP、串口、HTTP/WebSocket 与 Modbus 仍在路线图中。

## 为什么做这个

物联网开发通常依赖厂商硬件，而设备在内网，需要穿透才能访问。穿透通道不稳定、设备偶尔掉线，都会让联调停摆。DeviceForge 把设备侧的行为搬到本地：

- **不用改上位机网络配置**：设备可以监听 `127.0.0.1:端口` 等待上位机连接；需要模拟设备主动上报时，也可以配置 TCP Client 连接上游。
- **自定义协议可描述**：魔数、长度字段、字节序、BCD、校验和、请求响应和周期上报都用 YAML 表达。
- **行为可复现**：同一份配置可以反复启动、停止、重启，状态和报文实时可见。
- **故障可复现**：按方向、概率或包序号配置延迟、丢弃、断连和单 bit 损坏；录制会话保留收发流量和解码结果，便于事后回看。

## v0.1 已实现

- TCP server 设备（监听本机端口，支持多客户端连接）
- TCP client 设备（单个上游目标，启动不等待上游，指数退避自动重连）
- MQTT Client（连接外部 Broker，按主题订阅和发布）
- MQTT Broker（在本机启动 Broker，接受多个客户端连接）
- 设备运行状态与传输状态分离（连接中/已连接/重连中/已断开/错误）
- 分帧：`raw`、`delimiter`、`length-prefix`、`fixed`
- 编解码：`raw`（hex/ascii）、声明式 `fields` 和通用文本协议 `text`（报文变体、可选/重复字段、全局数据字典、ACK 重传、数组字段编码）
- 字段：`u8/i8/u16/i16/u24/i24/u32/i32/f32/f64`、`bytes`、`string`、`bcd`
- 校验：`sum8`、`xor8`、`crc8`、`crc16-modbus`、`crc16-ccitt`、`crc32`、`lrc`
- 规则：上线发送、收到匹配帧后响应、按周期上报、更新状态变量
- 故障注入：TCP 字节流分段、MQTT 消息级故障规则，支持延迟、丢弃、断连和单 bit 损坏
- 流量录制回看：逐设备手动录制，保存收发事件和解码结果，支持时间轴、暂停、倍速、单步和删除
- 模板：请求字段、设备状态、计数器、连接信息、设备信息和随机数
- 设备信息：可选的厂商、型号、S/N、硬件/固件版本和厂商自定义 TNS/IMEI 元数据
- Web 控制台：设备列表、可视化表单 / YAML 双模式配置、实时报文、hex dump、解码字段、手动发送、连接管理、状态查看、全局数据字典管理
- 配置持久化到 `data/devices.json`，本机自定义字典持久化到 `data/dictionaries.json`；报文和运行时状态保存在内存
- 录制会话以追加式文件保存在 Git 忽略目录 `data/recordings/`，由用户手动删除
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

## MCP 接口

服务端同时启动本机 MCP Streamable HTTP 接口，默认地址为 <http://127.0.0.1:7322/mcp>。MCP 固定监听 `127.0.0.1`，可用 `DEVICEFORGE_MCP_PORT` 修改端口。接口没有单独的认证层，不应通过反向代理或端口转发暴露到其他设备。

可用工具按能力分组：

- **项目文件**：`project_list_files`、`project_search_files`、`project_read_file`。路径以仓库根目录为边界；可读取仓库内所有文件，包括 Git 忽略的 `data/` 文件。越界路径和指向仓库外的符号链接会被拒绝。
- **设备配置**：`devices_list`、`devices_get`、`devices_list_presets`、`devices_validate_config`、`devices_create_from_yaml`、`devices_update_from_yaml`。配置创建和更新共用 REST API 的校验及字典迁移规则；创建设备后不会自动启动，更新运行中的设备会被拒绝。
- **设备运行**：`runtime_start`、`runtime_stop`、`runtime_restart`、`runtime_send`、`runtime_disconnect`。
- **流量记录**：`traffic_query`，可按方向和起始时间筛选内存中的收发及系统事件。

MCP 不提供删除设备或清空流量记录的工具。文件读取单次最多 2 MiB；搜索最多扫描 2000 个文件，并最多返回 500 处匹配。

仓库内本地运行文件可能含有明文凭据，例如 `data/devices.json` 中的 MQTT 密码。MCP 文件读取工具会原样返回文件内容，连接 MCP 的 agent 因而也能读取这些凭据。仅在可信的本机开发环境中启用该服务。

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

### 传输方式

`transport.type` 支持 `tcp-server`、`tcp-client`、`mqtt-client` 和 `mqtt-broker`：

- **`tcp-server`**：设备监听 `host:port`，可接受多个上位机连接。`port: 0` 表示自动分配，实际端口以运行状态中的端点为准。
- **`tcp-client`**：设备主动连接一个上游 `host:port`，用于模拟设备上报或网关连接。启动时不会等待上游可用；连接失败后按配置自动重连。
- **`mqtt-client`**：设备连接外部 MQTT Broker，订阅配置中的主题过滤器，也可向默认主题发布消息。连接失败后自动重连，默认 Client ID 使用设备 ID。
- **`mqtt-broker`**：设备在本机启动内嵌 MQTT Broker，默认监听 `127.0.0.1:1883`，可接受多个客户端；规则响应和手动发送均发布到配置主题，不要求当前已有客户端连接。

TCP Client 示例：

```yaml
transport:
  type: tcp-client
  host: 127.0.0.1
  port: 9000
  connectTimeoutMs: 5000
  reconnect:
    enabled: true
    minDelayMs: 500
    maxDelayMs: 10000
```

MQTT Client 示例：

```yaml
transport:
  type: mqtt-client
  url: mqtts://broker.example.com:8883
  clientId: sensor-01 # 可省略，默认使用设备 ID
  username: demo
  password: local-secret
  caFile: /etc/deviceforge/ca.pem # 可省略；仅 mqtts:// 可使用
  subscriptions:
    - topic: sensors/+/state
      qos: 1
  publishTopic: sensors/device-01/up
  publishQos: 1
```

内嵌 Broker 示例：

```yaml
transport:
  type: mqtt-broker
  host: 127.0.0.1
  port: 1883
  username: demo # 可选；配置后所有客户端共用这一组凭据
  password: local-secret
  certFile: /etc/deviceforge/server.crt # 可选；和 keyFile 同时配置时启用 mqtts://
  keyFile: /etc/deviceforge/server.key
  publishTopic: devices/device-01/down
  publishQos: 0
```

MQTT 固定使用 3.1.1，支持 QoS 0 和 1。每条 PUBLISH 的载荷直接作为一帧交给 codec，TCP 分帧设置不参与 MQTT 消息处理。入站主题、QoS 和 retain 状态可用于 `mqtt.topic`、`mqtt.qos`、`mqtt.retain` 模板；内嵌 Broker 还提供发布者 `mqtt.clientId`。帧规则可用 `topicFilter` 限定主题，例如 `sensors/+/state`，并用 `publishTopic` 覆盖默认出站主题：

```yaml
rules:
  - on: frame
    topicFilter: sensors/+/state
    publishTopic: replies/${mqtt.topic}
    send:
      hex: AABB
```

发布 QoS 由传输配置决定，出站 retain 固定关闭。MQTT Client 可填写 CA 文件；Broker 可同时填写证书和私钥启用 TLS。Broker 的用户名和密码为单组共享凭据。设备配置保存在本机 `data/devices.json`，其中的密码按明文保存；该目录由 Git 忽略。当前不提供 MQTT 5、QoS 2、WebSocket、主题 ACL、遗嘱或持久化会话。

| 字段 | 默认值 | 说明 |
| --- | --- | --- |
| `host` | `127.0.0.1` | 上游地址；可填写局域网或公网目标（仅主动外连） |
| `port` | 无 | 上游 TCP 端口，必须为 1-65535 |
| `connectTimeoutMs` | `5000` | 单次建连超时；超时后进入重连流程 |
| `reconnect.enabled` | `true` | 关闭后，连接失败或意外断线进入 `error`，不再重试 |
| `reconnect.minDelayMs` | `500` | 第一次重试等待，之后按 ×2 指数增长 |
| `reconnect.maxDelayMs` | `10000` | 退避等待上限；每次等待带 ±20% 抖动 |

传输状态与设备状态相互独立：设备启动后 `state` 为 `running`，上游暂时不可达时 `transport.state` 会显示 `connecting` 或 `reconnecting`，不会把设备判为启动失败。连接成功、意外断线、重连会分别推送 `connected`、`reconnecting` 等状态，前端会显示重试次数和下一次重试倒计时。

- 每次成功建连都会生成新的连接 ID，并重新执行 `on: connect` 规则；重连后的握手/注册逻辑不需要额外配置。
- 上游意外断开或连接失败会按退避策略自动重连；每次“故障期”只上报一次错误，后续重试只更新传输状态，避免反复弹出错误提示。
- 点击连接面板的“断开”或规则使用 `disconnect: true` 属于主动断开：进入 `disconnected` 并暂停自动重连；停止后重新启动设备即可恢复。
- 断线期间手动发送不会排队，会直接提示没有可用连接。
- TCP Client 可以连接非本机目标，但方向始终是“设备主动外连”；控制面仍只绑定本机，传输没有 TLS 或认证。

### 分帧方式

| `framing.type` | 说明 |
| --- | --- |
| `raw` | TCP 下每个数据块当作一帧；MQTT 不使用此分帧器，每条 PUBLISH 已有明确消息边界 |
| `delimiter` | 按分隔符切分；`delimiterFormat: text` 时 `delimiter` 是 UTF-8 文本（如 `"|"`、`"\r\n"`），`hex` 时是十六进制（如 `"7C"`、`"0D0A"`）；省略格式按 `hex` 兼容旧配置。`includeDelimiter` 控制是否保留分隔符 |
| `length-prefix` | 从指定偏移读取 1/2/4 字节长度，`adjust` 用于修正“长度是否包含头/CRC” |
| `fixed` | 固定帧长，不足时等待后续数据 |

文本分隔符示例：

```yaml
framing:
  type: delimiter
  delimiterFormat: text
  delimiter: "|"        # 匹配 0x7C
  includeDelimiter: false
```

- CRLF 写作 `delimiter: "\r\n"`。YAML 双引号会解析转义；单引号或不加引号的 `\r\n` 是字面反斜杠字符。`|`、`*`、`#` 等 YAML 特殊字符建议始终加引号。
- 文本模式按 UTF-8 编码。可视化表单支持 `\r`、`\n`、`\t`、`\0`、`\\`、`\xNN`；`\xNN` 表示 Unicode 码位 0x00-0xFF，不是原始字节，例如 `\x80` 编码为 `C2 80`。
- 文本模式中的 `"0D0A"` 是 4 个 ASCII 字符；需要原始字节 `0D 0A` 时请使用 HEX 模式。源码模式不做应用层转义解析。

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

### 通用文本协议（text）

`text` codec 用结构化配置描述任意“分隔符 + 有序字段”的文本协议。核心不包含厂商字段名或报文类型；设备配置决定一切。

```yaml
framing:
  type: delimiter
  delimiterFormat: text
  delimiter: "\r\n"
  includeDelimiter: false

codec:
  type: text
  separator: ":"
  terminator: "\r\n"
  timezone: Asia/Shanghai
  messages:
    - name: reading
      label: 数据上报
      prefix: "DATA"
      suffix: "END"
      slots:
        - { kind: field, name: deviceCode, type: string }
        - { kind: field, name: temperature, type: decimal, unit: "℃" }
        - { kind: field, name: sequence, type: int, optional: true, auto: sequence }
  session:
    ackMessage: ack
    trackMessages: [reading]
    sequenceField: sequence
    statusField: status
    successValues: ["OK"]
    timeoutMs: 5000
    maxRetries: 3
```

**模型**：

- **message**：`name` 出站时由 `fields.kind` 选择；入站按配置顺序匹配 `prefix`、`suffix` 和 `match`（完整 token 下标上的 equals/oneOf/regex/notEquals）。
- **slot**：`literal`（固定 token）、`field`（普通字段）、`repeat`（计数重复组）。slot 的顺序就是 token 顺序。
- **field type**：`string`、`int`、`decimal`（保留数值文本）、`timestamp`、`stringList`（默认 `|` 分隔）、`int16Array`（仅由字典 valueFormat 驱动）。
- **optional**：每条 message 最多一个 optional 字段；解码时会把它前面的字段从左解析、后面的字段从右解析，中间剩余 0/1 个 token 决定是否存在。报表尾部和 ACK 中间的可选流水号都能表达。
- **repeat**：必须有 `countField`（引用前面的 int 字段）；编码时由数组长度自动计算并覆盖。item 是单个顶层 token，item 内用 `itemSeparator` 分隔，值列表用 `valueSeparator`。`mapField` 会额外生成路径安全索引，例如 `data.item000`，便于模板引用。
- **auto**：`timestamp` 按 `format`（YYYY/MM/DD/HH/mm/ss）和 codec 时区生成；`sequence` 自动递增。显式传 `null` 可省略 optional 自动字段（如注册包）。
- **default / defaultFrom**：编码缺省值；`defaultFrom: tnsImei` 等可把设备信息绑定到设备码。
- **pattern**：解码校验，`error` 判为无效，`warning` 只提示。
- **dictionaries**：全局数据字典，`repeat.dictionary` 保存字典 ID，`keyField` 决定用哪个 item 字段查表。字典内容不再写进设备配置；未知码只记 warning。
- **session**：配置 ACK 报文、需要跟踪的报文、流水号/状态字段和成功值；不配置就完全没有 ACK/重传行为。

**ACK 与重传**：

- 满足 `session.trackMessages` 的报文发送后进入待确认队列；收到 `session.ackMessage` 中相同流水号且状态在 `successValues` 内的 ACK 后清除。
- `timeoutMs` 内未确认会重发同一份原始字节，最多重发 `maxRetries` 次；重试耗尽产生 error 事件和系统流量。
- 非 OK ACK 保留待确认并继续等待重试；未知 ACK 只记 info。
- TCP Client 和 MQTT Client 断线时暂停计时器；重连后先执行 `on: connect` 注册/握手，再按顺序恢复未确认报文。TCP Server 或内嵌 MQTT Broker 的客户端断开时丢弃该连接的 pending。
- 多连接时每个连接独立确认，互不影响。

**数组字段编码**：

- 在全局字典条目上声明 `valueFormat`。可在数据字典管理器的可视化视图编辑，也可切换到 JSON 源码视图：
  ```json
  {
    "002": {
      "name": "示例数组",
      "unit": "sample",
      "valueFormat": {
        "type": "int16Array",
        "points": 8,
        "endian": "be",
        "encoding": "hex",
        "crc": { "algo": "crc16-modbus", "endian": "le" }
      }
    }
  }
  ```
  repeat 中只写 `dictionary: codes`。
- 编码输入：repeat item 使用 `waveform: [8 个 int16]`；解码后 item 的 `values` 为空数组，`waveform` 包含 `points`、`crc`、`crcValid`、`encoding`；`mapField` 中只保留摘要，避免重复传输数组内容。
- CRC 校验失败时整帧仍然有效，但数组内容被丢弃（`points: null`）并记 warning。
- `encoding` 支持 `hex` / `base64`，都是文本安全形态。原始二进制波形段会与分隔符 tokenization 冲突，当前不包含；需要时使用 `length-prefix` / `fixed` 分帧配合后续的 binaryBlob 扩展。

### 全局数据字典

数据字典是跨设备的全局资源。设备配置只保存 `repeat.dictionary` 的 ID，不保存 entries；多个设备引用同一个 ID 时共享同一份码表。

- **自定义字典**：所有字典都保存在本机 `data/dictionaries.json`，该目录由 Git 忽略，不会随仓库提交或构建分发。可在控制台左侧数据字典管理器中用可视化表格编辑，或切换到 JSON 源码视图；保存后对运行中的设备立即生效，无需重启。
- **引用规则**：`repeat.dictionary` 必须是合法的全局 ID；服务端在保存设备、加载 `devices.json` 和校验预设时检查引用，缺失引用返回 422 或跳过该设备。字典 ID 按大小写不敏感规则检查唯一性，引用仍须与定义中的大小写完全一致。
- **删除保护**：有效设备和可识别出字典引用的无效设备记录都会阻止删除。无效设备不会在字典变更后自动重试；修复数据后需重启服务，设备才会重新加载。更新字典内容不会被阻止，下一帧编解码即使用新内容。ID 创建后不可修改，名称可以修改。
- **自动迁移**：启动时会把旧 `codec.dictionaries` 转成全局字典并改写 repeat 引用，原 `devices.json` 备份为 `devices.json.pre-dictionary-migration-<timestamp>.bak`；设备 POST/PUT 也接受旧内联字典并自动迁移。迁移遇到已有同 ID 字典时只比较 entries，条目相同便保留现有字典名称和说明；条目不同则返回冲突。`/api/config/validate` 不落盘迁移，旧内联配置会返回明确的 422 提示。

API：

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/dictionaries` | 字典列表，含 `usedBy` |
| GET | `/api/dictionaries/:id` | 查询单个字典，含 `usedBy` |
| POST | `/api/dictionaries` | 新建自定义字典 |
| PUT | `/api/dictionaries/:id` | 更新自定义字典 |
| DELETE | `/api/dictionaries/:id` | 删除自定义字典；被引用时 409 |

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
- `tnsImei` 是单个不透明字符串，不做 IMEI/TNS 格式校验，也不强制唯一；`text` codec 可用 `defaultFrom: tnsImei` 把它作为设备码回退值。
- 所有设备信息都可以在模板中通过 `$device.*` 引用（例如 `$device.tnsImei`）；厂商/型号/版本等仍只用于展示和记录，不直接参与分帧或字段编码。
- 字段命名参考 LwM2M Device Object、OPC UA DI 等模型中的 Manufacturer/Model/SerialNumber 概念，不是某个具体协议的线格式。

## 规则与模板

规则触发方式：

- `on: start`：设备启动后执行一次
- `on: connect`：每次连接建立时执行；TCP Client 每次重连后也会重新执行
- `on: frame` + `match`：收到匹配的帧时执行；不写 `match` 表示匹配所有帧
- `every: 毫秒`：周期执行，可配 `jitter`；`target: all | last` 控制广播还是发给最近连接

`set` 在发送前更新设备状态。`send` 可以是单个消息或消息数组；`disconnect: true` 会在发送后断开当前连接。对 TCP Client 来说，主动断开会暂停自动重连，重启设备后恢复。

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
| `$device.tnsImei` | 设备信息中的 TNS/IMEI、型号、序列号等 |
| `$req.data.item001.value` | repeat 字段映射出的某个条目值 |
| `$now` | 当前时间戳（毫秒） |
| `${random(20,30)}` | 闭区间随机整数 |
| `${randomFloat(20,30)}` | 保留两位小数的随机浮点数 |
| `${and(state.online, state.temp > 20)}` | 逻辑与；还支持 `or`/`not`、`&&`/`||`/`!` |
| `${state.temp + 1}` | 算术；支持 `+ - * / %`、比较和括号 |
| `seq=${req.seq}` | 字符串插值；`${...}` 内可以写 `req.*`、`state.*`、`counter.*`、`conn.*`、`device.*` |

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

## 故障注入与录制回放

每台设备的故障规则保存在设备配置中，运行时可在设备页的「故障注入」面板启停，也可以在设备运行时修改规则。服务重启或设备停止后，注入默认关闭。规则按列表顺序检查，每个 TCP 片段或 MQTT 消息只执行首条命中规则。

```yaml
faultInjection:
  segmentSizeBytes: 256 # TCP 入站、出站分段长度；尾段空闲 5 ms 后处理
  rules:
    - id: delay-first-inbound
      name: 延迟首个入站片段
      enabled: true
      direction: in # in、out 或 both
      trigger:
        type: sequence
        mode: indices
        indices: [1]
      action:
        type: delay
        delayMs: 250
    - id: drop-every-fifth-message
      name: 每五条 MQTT 入站消息丢弃一条
      direction: in
      trigger:
        type: sequence
        mode: every
        interval: 5
      action:
        type: drop
```

触发条件可选概率（`type: probability`，`percent: 0–100`）或序号（指定 `indices`、每 `interval` 次触发）。序号从 1 开始，在每条连接、每个方向分别计数。动作支持 `delay`、`drop`、`disconnect` 和 `corrupt`；损坏动作随机翻转一个 bit。TCP 按配置的字节长度切段，MQTT 按完整 PUBLISH 载荷处理。出站丢弃仍会进入协议现有的应用层 ACK 超时和重试流程。

「录制回放」面板按设备单独开始和停止录制。会话保存收发流量、系统事件、解码结果及 MQTT 主题、QoS、retain 等元数据；时间轴支持播放、暂停、0.5× 到 4× 倍速、逐条步进和删除。回放只读取历史事件，不向设备发送数据，也不重新执行规则。会话和事件以 `data/recordings/<设备 ID>/<会话 ID>/` 下的 `session.json`、`events.jsonl` 持久化；目录已被 Git 忽略。应用异常退出后，已写入事件仍可读取，会话状态标记为未正常结束。磁盘写入失败会停止当前录制，并在面板中显示错误。

服务端 API：

- `GET /api/devices/:id/fault-injection` 读取规则和运行时启用状态；`PUT /api/devices/:id/fault-injection/rules` 热更新规则；`PATCH /api/devices/:id/fault-injection` 修改运行时启停状态。
- `GET /api/devices/:id/recordings` 列出会话；`POST /api/devices/:id/recordings` 开始录制；`POST /api/devices/:id/recordings/:recordingId/stop` 停止；`GET /api/devices/:id/recordings/:recordingId/events?offset=0&limit=200` 分页读取；`DELETE /api/devices/:id/recordings/:recordingId` 删除已停止的会话。
- **注释**：可视化编辑后重新生成 YAML 会丢失注释；配置本身由服务端以 JSON 持久化，YAML 注释也不会跨保存/重载保留。
- **状态保存**：保存会替换整个状态对象，便于删除键；编辑期间规则产生的其他状态更新会被当前草稿覆盖。

## 项目结构

```text
packages/core      设备引擎：schema、framing、codec、checksum、rules、runtime、TCP 与 MQTT transport
packages/server    Fastify REST + WebSocket + MCP 传输/能力模块 + 应用服务 + JSON 持久化 + 静态托管
packages/web       React + Vite + Tailwind 控制台
presets/           内置 YAML 预设
data/              本机运行数据（devices.json、dictionaries.json，gitignored）
scripts/           演示客户端
packages/core/src/__tests__/  单元测试和 TCP 集成测试
```

`packages/core` 不依赖 HTTP/UI，可以直接在测试或 CI 中 `new DeviceRuntime(config)` 使用。

## 开发与测试

```bash
pnpm -r typecheck    # 三个包的类型检查
pnpm test            # 核心 + 服务端应用服务/MCP + Web 测试
pnpm build           # 类型检查 + 构建前端
pnpm dev             # server + Vite
pnpm start           # 生产模式（需要先 build）
```

测试覆盖：

- CRC/校验和已知向量（CRC16/MODBUS `123456789 → 0x4B37` 等）
- length-prefix 半包、粘包、多帧、超长帧
- delimiter（hex/text 分隔符、UTF-8 多字节跨包）、fixed、raw 分帧
- 字段编解码回环、CRC 校验失败、固定长度/剩余长度/fromField
- 通用 `text` codec：prefix/suffix/match、optional 字段、自动时间戳/流水号、repeat/字典/mapField、pattern 警告和异常帧
- 全局数据字典：schema/ID 校验、引用收集、内联字典迁移、已有字典匹配、ID 冲突、无效数据保留、运行时实时 provider
- 服务端字典仓库与设备存储：本机字典加载与 CRUD、损坏备份、启动迁移、备份文件、幂等和跨设备前向引用
- MCP：Streamable HTTP 握手与关闭、工具注册及参数校验、设备运行控制、收发记录筛选、项目路径越界和外部符号链接拒绝
- 设备配置应用服务：REST/MCP 共用 YAML 校验与写入、字典迁移、重复 ID、运行中更新拒绝和预设排序
- 文本 codec：字段、重复组、时间戳、流水号、字典查表、ACK 和重传
- ACK 会话：超时重发、最大重试、非 OK/未知 ACK、TCP/MQTT Client 暂停与重连恢复、TCP Server/MQTT Broker 断连丢弃、stop 清理
- 数组字段：int16 BE、CRC16/Modbus 已知向量、hex/base64 round-trip、CRC 失败丢弃、CRC 字节序
- 模板求值（路径、算术、比较、布尔函数、插值扫描、错误和限制）、模板补全 token/候选/插入，以及字段匹配
- 真实 `node:net` 客户端连 TCP 设备：握手、请求响应、手动发送、错误 CRC 不触发规则
- TCP Client 传输：目标未启动时正常启动、自动重连、主动断开暂停、关闭重连、收发与字节计数
- TCP Client 设备运行时集成：重连后重新执行 `on: connect`、断线发送报错、设备状态保持 `running`
- MQTT Client 与内嵌 Broker：QoS 0/1 收发、共享认证、TLS 文件错误、重连、多客户端、主题规则过滤与覆盖、应用层 ACK 重试
- 设备信息 `deviceInfo` 的 schema 解析和 Web 端元数据归一化/摘要
- Web 端配置默认值、传输展示/状态文案、YAML/JSON 序列化、JSON 值编辑、规则触发/send/match 转换的纯函数测试

本地文档统一放在 `docs/`；该目录已加入 `.gitignore`，不会进入版本库。

## 环境变量

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `DEVICEFORGE_PORT` | `7321` | 控制面端口 |
| `DEVICEFORGE_HOST` | `127.0.0.1` | 控制面绑定地址 |
| `DEVICEFORGE_MCP_PORT` | `7322` | 本机 MCP Streamable HTTP 端口，固定绑定 `127.0.0.1` |
| `DEVICEFORGE_DATA_DIR` | `<repo>/data` | 设备配置和本机自定义字典存储目录 |
| `LOG_LEVEL` | `info` | Fastify/Pino 日志级别 |

模拟设备的端点由设备配置中的 `transport` 决定：TCP Server 监听 `transport.host/port`，TCP Client 主动连接该目标；控制面本身仍只绑定本机。

## 路线图

| 里程碑 | 内容 |
| --- | --- |
| **M2 传输扩展（进行中）** | TCP Server / TCP Client / MQTT Broker / MQTT Client（已支持）；UDP（下一阶段）、串口、HTTP server、WebSocket server、虚拟串口（Linux/macOS socat，Windows com0com） |
| **M3 Modbus（暂缓）** | Modbus TCP/RTU slave，FC 01/02/03/04/05/06/15/16，寄存器/线圈表，异常响应 |
| **M4 可靠性** | 故障注入和流量录制回看已支持；JS script codec（worker + vm）、透明代理、虚拟时钟、多设备场景、CI |
| **更远** | CoAP、OPC UA、BACnet、BLE、pcapng 导出、可视化协议编辑器、Docker 发行 |

## 已知限制

- TCP Client 为单目标。MQTT 仅支持 3.1.1 与 QoS 0/1；UDP、串口、HTTP/WebSocket 仍在路线图中。
- 设备配置会持久化；实时流量历史和运行时状态不会跨服务重启保留，重启后状态回到配置中的 `state`。手动录制的会话保存在 `data/recordings/`，异常退出后以中断状态恢复读取。
- 可视化编辑会重新生成 YAML，源码模式中的注释和原格式只在当前编辑会话、且未做可视化修改时保留；服务端本身只存 JSON。
- 模板补全只在可视化模板输入中提供；YAML/JSON 源码模式没有补全。
- TCP transport 不提供 TLS 或认证；MQTT Client 支持 mqtts 和 CA 文件，内嵌 Broker 支持 mqtts 与单组共享凭据。控制面默认只绑定 `127.0.0.1`，不要直接暴露到公网。
- `raw` framing 在 TCP 上把每个数据块当作一帧，不保证与业务消息边界一致；带明确边界的协议请使用 length-prefix/delimiter/fixed。
- JS script codec、透明代理、虚拟时钟和多设备场景尚未实现；当前 UI 中的协议标签已标注“规划中”。
- 所有数据字典均为本机自定义数据，保存在 Git 忽略的 `data/dictionaries.json`。被设备引用的字典不能删除。
- 旧配置的内联字典在启动或设备 POST/PUT 时自动迁移；`/api/config/validate` 只预览，不落盘，因此源码模式粘贴旧内联字典会返回 422。

## 设计约定

- **入站分帧、出站编码**：Framer 只拆分字节流，Codec 负责完整帧的编码/解码（含长度、常量、校验）。
- **设备状态是设备级的**：`state` 被所有连接共享；`req/conn/counter` 是请求或连接上下文。
- **运行状态与传输状态分离**：设备是否启动由 `status.state` 表示，连接/重连由 `status.transport` 表示；上游不可达不会把设备判为启动失败。
- **规则按顺序执行**：一帧可以命中多条规则；每条规则的 `set` 在发送前生效。
- **HTTP 控制面和模拟数据面分离**：控制面固定在本机端口；模拟设备端口独立配置，互不影响。
