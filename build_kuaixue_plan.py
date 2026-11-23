from docx import Document
from docx.shared import Inches, Pt, RGBColor
from docx.oxml import OxmlElement
from docx.oxml.ns import qn

OUT = r"E:\快学课堂\快学客户端建设实施方案_P0-P10.docx"
doc = Document()
sec = doc.sections[0]
sec.top_margin, sec.bottom_margin = Inches(.72), Inches(.68)
sec.left_margin, sec.right_margin = Inches(.78), Inches(.78)
normal = doc.styles["Normal"]
normal.font.name = "Microsoft YaHei"
normal._element.rPr.rFonts.set(qn("w:eastAsia"), "Microsoft YaHei")
normal.font.size = Pt(9.5)
for name, size in (("Title", 25), ("Heading 1", 16), ("Heading 2", 12)):
    s = doc.styles[name]
    s.font.name = "Microsoft YaHei"
    s._element.rPr.rFonts.set(qn("w:eastAsia"), "Microsoft YaHei")
    s.font.size = Pt(size)

def body(text):
    p = doc.add_paragraph(text)
    p.paragraph_format.space_after = Pt(6)
    p.paragraph_format.line_spacing = 1.2
    return p

def label(name, value):
    p = doc.add_paragraph()
    p.paragraph_format.space_after = Pt(3)
    a = p.add_run(name)
    a.bold = True
    p.add_run(value)
    return p

def phase(doc, code, name, status, goal, work, gate):
    heading = doc.add_heading(f"{code}  {name}", level=2)
    heading.paragraph_format.keep_with_next = True
    items = [("状态：", status), ("目标：", goal), ("工作：", work), ("退出条件：", gate)]
    for index, (name, value) in enumerate(items):
        p = label(name, value)
        p.paragraph_format.keep_with_next = index < len(items) - 1

p = doc.add_paragraph(style="Title")
p.paragraph_format.space_before = Pt(70)
p.add_run("快学客户端项目实施方案")
p = doc.add_paragraph()
p.add_run("P0–P10 分阶段建设与交付计划")
body("版本 1.0  |  日期 2026 年 11 月 22 日  |  面向产品、研发、设计、运营与交付团队")
body("本方案定义快学客户端的目标、系统分工、阶段顺序、交付物与验收门槛。目标是独立安装式桌面应用，不是浏览器 Web 客户端。当前源码仓库仅做只读盘点，生产接口仍须按 P1 完成联调确认。")

def add_table(headers, rows, widths=None):
    t = doc.add_table(rows=1, cols=len(headers))
    t.style, t.autofit = "Table Grid", False
    if widths:
        for col, width in zip(t.columns, widths): col.width = Inches(width)
    for i, text in enumerate(headers):
        c = t.rows[0].cells[i]
        c.text = text
        shd = OxmlElement("w:shd")
        shd.set(qn("w:fill"), "17324D")
        c._tc.get_or_add_tcPr().append(shd)
        for r in c.paragraphs[0].runs:
            r.font.name = "Microsoft YaHei"
            r._element.get_or_add_rPr().rFonts.set(qn("w:eastAsia"), "Microsoft YaHei")
            r.font.bold, r.font.size, r.font.color.rgb = True, Pt(8.5), RGBColor(255, 255, 255)
    trpr = t.rows[0]._tr.get_or_add_trPr()
    repeat = OxmlElement("w:tblHeader")
    repeat.set(qn("w:val"), "true")
    trpr.append(repeat)
    for ri, values in enumerate(rows):
        cells = t.add_row().cells
        if widths:
            for c, width in zip(cells, widths): c.width = Inches(width)
        for i, text in enumerate(values):
            cells[i].text = text
            if ri % 2:
                shd = OxmlElement("w:shd")
                shd.set(qn("w:fill"), "F4F7F8")
                cells[i]._tc.get_or_add_tcPr().append(shd)
            for p in cells[i].paragraphs:
                p.paragraph_format.space_after = Pt(0)
                p.paragraph_format.line_spacing = 1.1
                for r in p.runs:
                    r.font.name = "Microsoft YaHei"
                    r._element.get_or_add_rPr().rFonts.set(qn("w:eastAsia"), "Microsoft YaHei")
                    r.font.size = Pt(8.5)
    doc.add_paragraph().paragraph_format.space_after = Pt(1)

doc.add_heading("执行摘要", level=1)
body("快学客户端是一款独立安装的 AI 课程桌面应用。用户使用创易灵动账号登录，在客户端选择画布课程或 VibeCoding 课程，通过积分或支付解锁；积分不足时可充值。解锁后进入课程指定的创作工作区，按照运营人员预设的步骤完成创作。")
body("建议复用灵动 AI 客户端已有的 Electron 外壳与 VibeCoding 运行时，并以独立产品配置构建快学客户端；画布能力沿用灵动 AI 学院的画布实现。复用技术和创作能力，不复用学院的机构、教师、班级和课堂授权链路。")
body("创易灵动是账号、积分余额和支付账本的权威来源；快学课堂负责课程、版本、购买权益、学习进度和运行时上下文。课程解锁与后续 AI 生成是两类交易，必须分开展示、授权和记账。")

doc.add_heading("一、产品目标与用户流程", level=1)
body("快学课堂不设置教师、机构或班级概念。用户自主选课和学习，运营人员通过后台配置课程内容、步骤、模型范围和价格。")
add_table(["步骤", "产品行为"], [
    ("登录", "使用创易灵动账号进入快学客户端，不另建账号密码或积分余额。"),
    ("选课", "从画布课程、VibeCoding 课程两个模块浏览课程，查看目标、步骤、价格、模型范围和作品示例。"),
    ("解锁", "按配置使用积分购买或直接付款；积分不足时可充值。支付结果以服务端回调确认。"),
    ("创作", "点击已解锁课程进入对应工作区；画布显示预设步骤框体，VibeCoding 打开本地项目和课程指引。"),
    ("继续学习", "服务端保存课程版本、步骤进度和作品状态；重新登录后恢复权益与可恢复的进度。"),
], [1.05, 5.95])

doc.add_page_break()
doc.add_heading("二、产品与系统边界", level=1)
add_table(["系统", "权威职责", "不负责的内容"], [
    ("创易灵动主站", "账号身份、积分余额、充值/支付账本、支付订单结果。", "不维护快学课程步骤和学习进度。"),
    ("快学课堂服务", "课程目录、课程版本、价格、购买权益、学习进度、运行实例和模型策略。", "不创建机构、教师、班级或学院课堂。"),
    ("快学管理后台", "课程录入、步骤/素材、模型白名单、价格、预览、审核和发布。", "不直接改写积分余额或伪造支付成功。"),
    ("快学客户端", "登录、模块/课程选择、支付/充值发起、创作工作区、进度和安装更新。", "不保存模型供应商密钥，不自行判定支付或扣费成功。"),
    ("灵动 AI 客户端与学院画布", "提供可复用的 VibeCoding 桌面运行时和画布编辑器能力。", "其机构账号、课堂门禁和课堂额度不直接作为快学授权。"),
], [1.25, 3.0, 2.75])
body("kt.aicyld.com.cn 是快学服务入口，可承载登录授权、课程/API、支付回调、安装包下载或更新清单。桌面客户端是本地安装应用，不要求用户通过浏览器完成创作；快学不跳转或依赖 hb.aicyld.com.cn。")

doc.add_heading("三、建议的技术实现", level=1)
body("桌面端建议从灵动 AI 客户端代码库增加独立快学产品配置，复用 Electron 主进程、VibeCoding 工具链和更新框架。快学需有独立应用身份、品牌、数据目录、深链协议、登录态和更新通道，避免安装冲突或错误升级。是否共用仓库发布流水线，在 P1 构建验证后定案。")
body("VibeCoding 使用现有本地项目工作区，但身份从“学院学生 + 课堂”改为“创易灵动用户 + 快学课程版本 + 课程运行实例”。进度、授权和作品记录由服务端持久化；文件同步、备份和跨设备恢复范围在 P1 确认。")
body("画布沿用灵动 AI 学院画布实现，并在快学客户端内提供课程专属页面。优先验证将画布 UI 与步骤容器集成到同一客户端渲染层；如需隔离 WebView，先确认凭据传递、导航白名单、文件访问和安全边界。")
body("客户端启动时获取快学课程运行上下文，至少包含用户、课程、发布版本、运行实例、权益、步骤、模型白名单、服务端报价和短时运行凭据。每次生成请求均由服务端重新验证权益、模型权限和积分余额。")

doc.add_heading("四、课程与计费规则", level=1)
body("课程解锁与创作消耗分开管理。运营后台可配置课程类型、步骤、素材、积分解锁价、现金支付价和允许模型；模型价格、预估消耗和最终扣费由服务端报价与校验。")
add_table(["交易类型", "触发时机", "账务要求"], [
    ("课程解锁", "购买课程或课程包。", "订单与课程权益绑定；请求幂等；记录退款、撤销和权益状态。"),
    ("积分充值", "用户购买积分余额。", "由主站充值/支付系统入账，快学只发起并展示状态。"),
    ("模型生成", "在画布或 VibeCoding 中提交任务。", "展示估算；服务端校验白名单、预算和余额；完成后结算，失败按规则释放或退款。"),
], [1.1, 1.8, 4.9])
body("模型限制不能只靠客户端隐藏选项。每次任务提交均由服务端验证课程模型清单；模型供应商密钥保留在服务端。")

doc.add_heading("五、P0–P10 实施阶段", level=1)
body("各阶段按依赖顺序推进，达到退出条件后再进入下一阶段。工期与人力在 P1 接口和技术验证完成后估算，不预设未经验证的固定日期。")
phase(doc, "P0", "目标与代码基线", "已完成只读初盘，以本方案目标为准", "确认快学是独立桌面客户端，复用现有 VibeCoding 客户端和学院画布，不接入 HB。", "核对 Electron 客户端、学院画布和课堂依赖；记录仓库边界、复用资产与未提交改动；不修改源码。", "产品边界、复用候选和主要耦合点形成清单，用户改动未被覆盖。")
phase(doc, "P1", "跨系统契约与技术验证", "评估中，研发实现前置门槛", "确认账号、积分、支付、课程权益和桌面运行时的真实接口。", "确定首发操作系统；验证独立客户端构建身份；确定主站登录交接、积分与现金支付 API、退款语义；验证 Canvas 桌面集成；定义运行上下文、报价、工作区和进度恢复契约。", "关键接口有负责人和样例；Canvas PoC 可在快学壳内运行；VibeCoding PoC 不依赖学院课堂；幂等与支付回调方案确认。")
phase(doc, "P2", "快学服务与数据域", "待开始，依赖 P1", "建立与学院机构/课堂隔离的快学后端能力。", "设计课程、课程版本、步骤、用户权益、课程运行实例、进度、作品、订单关联和模型策略；实现身份映射、课程读取、权益校验与进度保存 API。", "服务端按创易灵动用户返回课程和权益；课程新版本不破坏在学用户固定的旧版本运行实例。")
phase(doc, "P3", "快学桌面产品形态", "待开始，依赖 P1", "基于现有 Electron 客户端形成独立快学安装包和入口。", "实现快学品牌、登录、两模块首页、课程路由、应用数据目录、更新通道与深链；支持与灵动 AI 客户端并行安装。", "安装、升级、卸载和回滚不影响灵动 AI 客户端；登录后进入画布课程与 VibeCoding 课程模块。")
phase(doc, "P4", "课程运营后台", "待开始，依赖 P2", "让运营人员独立配置并发布课程。", "管理课程类型、介绍、封面、步骤、素材、示例、学习目标、价格、允许模型、预估说明、预览、审核、版本发布和下架。", "两类课程都能创建、预览、发布和下架；学生侧读取正确的已发布版本快照。")
phase(doc, "P5", "课程目录与购买权益", "待开始，依赖 P2–P4", "完成浏览、购买、充值和权益闭环。", "展示课程详情、余额、积分价/现金价；接入积分购买、直接付款与积分充值；处理订单状态、重复回调、失败、退款与权益发放。", "只有服务端确认的订单才能解锁；重复回调不重复扣款或发放权益；重启后状态一致。")
phase(doc, "P6", "画布课程工作区", "待开始，依赖 P2–P4", "购买后直接进入课程专属画布并显示预设步骤框体。", "复用学院画布核心；加载已发布课程模板与素材；显示步骤与完成状态；将操作、进度和作品关联到课程运行实例。", "进入后看到正确模板和步骤；重新打开可恢复课程版本、步骤进度和作品。")
phase(doc, "P7", "VibeCoding 课程工作区", "待开始，依赖 P1–P4", "复用灵动 AI 客户端 VibeCoding 引擎，但使用快学课程上下文。", "增加快学平台适配器；按用户、课程版本和运行实例隔离本地工作区；加载步骤、素材和规则；保存进度与作品；按课程模型清单展示模型。", "无需教师开课或机构授权即可进入；伪造客户端参数不能绕过权益和模型门禁。")
phase(doc, "P8", "积分计费与模型控制", "待开始，贯穿 P5–P7", "完成生成估价、扣费、结算和失败退款。", "整合主站积分账本；展示预估与最终价；服务端按幂等号预扣、记录用量、成功结算、失败释放/退款；设置预算与审计记录。", "并发、重试、超时、供应商失败和断线不重复扣费或造成负余额；账务可追溯。")
phase(doc, "P9", "端到端验收与安全", "待开始，依赖 P2–P8", "验证两类课程、支付和账务链路可控。", "验收登录、无权益拦截、积分/支付购买、模型白名单、课程版本、步骤恢复、工作区隔离、画布模板、断网重试、退款和更新。", "关键路径有自动化与人工记录；账务对账无差异；阻断级缺陷清零。")
phase(doc, "P10", "灰度发布与运营", "待开始，依赖 P9", "以独立客户端和可回滚服务端版本上线。", "配置 kt.aicyld.com.cn、安装包分发和更新清单；小范围灰度；监控登录、购买、生成、退款、更新和崩溃；准备告警、客服和回滚手册。", "灰度指标达标后逐步放量；异常时可停止新购买/发布并回滚；订单与权益可审计。")

doc.add_heading("六、首发验收清单", level=1)
checks = [
    "用户以创易灵动账号登录，不需注册机构或等待教师开课。",
    "客户端提供画布课程与 VibeCoding 课程两个模块和课程目录。",
    "课程详情展示价格、学习目标、步骤预览和可用模型范围。",
    "用户可用积分解锁；积分不足时可充值；开放现金购买的课程须在支付确认后解锁。",
    "购买画布课程后直接进入对应画布，看到运营预设步骤框体。",
    "购买 VibeCoding 课程后进入本地工作区，不依赖学院课堂会话。",
    "生成前展示允许模型和估算消耗；服务端拒绝白名单外的模型请求。",
    "课程解锁与模型生成分开记账；失败任务按规则释放或退还积分。",
    "用户或课程切换不串用本地项目；重装后可恢复服务端权益和已保存进度。",
    "快学客户端与灵动 AI 客户端可并行安装和升级，互不覆盖数据或配置。",
]
for item in checks:
    p = doc.add_paragraph(style="List Bullet")
    p.paragraph_format.left_indent = Inches(.24)
    p.paragraph_format.first_line_indent = Inches(-.13)
    p.paragraph_format.space_after = Pt(3)
    p.add_run(item)

doc.add_heading("七、主要风险与决策门", level=1)
add_table(["风险/待确认项", "影响", "处理方式"], [
    ("主站登录、支付和积分接口未确认", "无法建立可信账号与资金闭环。", "P1 确认身份交接、充值、扣减、支付回调、退款与幂等契约；不新建余额账本。"),
    ("VibeCoding 仍绑定学院课堂上下文", "个人购买用户无法进入或隔离项目。", "以 courseRunId 替代 classSessionId；网关验证快学权益和课程模型策略。"),
    ("Canvas 桌面集成未验证", "可能外跳网页或重复维护画布。", "P1 完成桌面集成 PoC，并确认同渲染层或隔离 WebView 方案。"),
    ("课程更新影响在学用户", "步骤、模型或素材变化可能破坏进度。", "课程版本不可变发布；运行实例固定版本；定义旧版本继续学习和迁移规则。"),
    ("本地工作区不能跨设备恢复", "用户换设备可能丢失未提交文件。", "P1 确认云同步范围、作品提交时机、备份与导出能力。"),
    ("估价与真实扣费不一致", "引发投诉或平台成本风险。", "报价和扣费规则服务端统一；保存报价版本、模型、用量和结算流水。"),
    ("客户端身份或更新通道混用", "可能覆盖灵动 AI 客户端或下发错误版本。", "独立应用 ID、产品名、数据目录、深链协议和更新清单；并行安装是发布门槛。"),
], [1.55, 2.0, 3.45])

doc.add_heading("八、实施原则与范围", level=1)
for item in [
    "快学课堂是独立产品，不接入 hb.aicyld.com.cn 的页面、路由或运行时入口。",
    "账号、积分和支付沿用创易灵动；课程、版本、权益、进度与运行实例属于快学业务域。",
    "复用灵动 AI 客户端 VibeCoding 技术，不复用学院机构课堂授权和教师开课条件。",
    "课程解锁费用与 AI 生成消耗分别展示、授权和记账。",
    "客户端只负责交互；支付结果、课程权益、模型许可和最终扣费均由服务端判定。",
    "首发操作系统、支付渠道、现金购买范围与作品云同步在 P1 锁定后纳入排期。",
]:
    p = doc.add_paragraph(style="List Bullet")
    p.paragraph_format.left_indent = Inches(.24)
    p.paragraph_format.first_line_indent = Inches(-.13)
    p.paragraph_format.space_after = Pt(3)
    p.add_run(item)

doc.add_heading("附录：只读评估依据", level=1)
body("只读盘点发现，灵动 AI 客户端已有 Electron 桌面外壳、VibeCoding 登录与运行时、模型网关、本地工作区、作品提交和安装更新能力；其当前上下文以学院学生和进行中课堂为核心。学院课程配置已区分 CANVAS 与 VIBECODING；画布核心位于学院项目的 Canvas 包。上述结论用于确定复用候选，不代表生产接口已与创易灵动主站完成联调。")
body("P1 完成前，账号、积分、支付、模型报价、退款、课程权益和运行实例接口均为待联调确认；本方案不将候选接口描述为已存在的生产能力。")

doc.core_properties.title = "快学客户端项目实施方案 P0-P10"
doc.core_properties.subject = "桌面客户端建设目标、架构边界与分阶段实施计划"
doc.core_properties.author = "项目组"
doc.core_properties.keywords = "快学客户端,桌面客户端,AI课程,画布课程,VibeCoding,P0-P10"
doc.save(OUT)
print(OUT)

