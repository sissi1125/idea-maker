// Shared mock data + helpers.

const PROJECTS = [
  { id: "p1", name: "Lumio 蓝牙音响营销", emoji: "🔊", docs: 8, updated: "2 小时前", created: "2025-01-08", description: "面向 18-30 岁年轻用户的便携蓝牙音响产品系列。", cost: 12.34 },
  { id: "p2", name: "MUJI 风家居香薰", emoji: "🕯️", docs: 5, updated: "昨天", created: "2025-01-03", description: "极简日式风格家居香薰品牌。", cost: 5.21 },
  { id: "p3", name: "Daily Greens 轻食", emoji: "🥗", docs: 12, updated: "3 天前", created: "2024-12-22", description: "代餐沙拉与轻食外卖品牌。", cost: 28.94 },
  { id: "p4", name: "Northpaw 户外背包", emoji: "🎒", docs: 3, updated: "上周", created: "2024-12-10", description: "硬核户外徒步背包系列。", cost: 2.10 },
];

const PRESET_QUESTIONS = [
  { id: "q1", icon: "💡", title: "生成 5 个卖点及小红书笔记", hint: "适合冷启动 / 新品上市",   tag: "营销文案" },
  { id: "q2", icon: "📊", title: "对比竞品优势，生成差异化卖点", hint: "横向定位，找出独特价值", tag: "竞品分析" },
  { id: "q3", icon: "🎨", title: "为产品生成 3 种不同风格的文案", hint: "口语 / 情感 / 数据派",  tag: "风格测试" },
  { id: "q4", icon: "📱", title: "生成小红书、微博、抖音三端文案", hint: "多平台分发，自动适配语气", tag: "多渠道" },
  { id: "q5", icon: "🌟", title: "生成产品使用场景故事和配图 prompt", hint: "可直接拿去画图生成图", tag: "场景化" },
];

// Thinking trace (used by the agent panel)
const THINKING_TRACE = {
  think: [
    "用户希望针对 Lumio Pulse 蓝牙音响生成 5 个卖点 + 适合小红书风格的笔记。",
    "应先查阅 product_guide.pdf 提取核心特性，再对照 competitor_info.pdf 找出差异化。",
    "目标受众是 18–30 岁城市年轻用户，文案应偏「氛围感」+「轻种草」语气。"
  ],
  search: {
    chunks: [
      { id:"c1", file:"product_guide.pdf",       lines:"L10–L25",  preview:"24h 续航，IPX7 防水，5cm 全频单元 + 被动振膜，支持双机互联…", conf: 0.94 },
      { id:"c2", file:"product_guide.pdf",       lines:"L88–L102", preview:"配色：奶油白 / 雾岩灰 / 落日橘；表面 EVA 纺织包覆，耐刮防滑…",        conf: 0.88 },
      { id:"c3", file:"competitor_analysis.pdf", lines:"L45–L60",  preview:"竞品 A 续航 18h，无防水；竞品 B 续航 30h，但缺乏轻量化与配色…",     conf: 0.91 },
    ],
    overallConf: 0.92,
  },
  tools: [
    { name:"generate_marketing_copy",   args:'{ style:"persuasive", length:"medium", tone:"warm" }', ms: 1840 },
    { name:"score_selling_points",       args:'{ count: 5, channel:"xiaohongshu" }',                  ms:  620 },
  ],
  selfEval: [
    { ok:true,  text:"覆盖了 5 个卖点，每点都映射到至少 1 个产品特性来源。" },
    { ok:true,  text:"语气与小红书种草风格匹配，使用了「氛围感 / 真香 / 一秒回家」等场景词。" },
    { ok:false, text:"竞品对比数据可补充更多具体数字（如续航实测、防水等级对比）。" },
  ],
};

const GENERATED_RESULT = {
  title: "Lumio Pulse — 5 篇小红书笔记草稿",
  subtitle: "每个卖点对应一篇独立笔记，包含正文、配图 prompt 与单独评分",
  notes: [
    {
      tag:"续航",
      angle:"24h 长续航 + 快充",
      hashtags:["#续航党狂喜","#带去露营","#蓝牙音响推荐"],
      body:"周五下班顺手把它塞进通勤包，一路听到周日露营回来，居然还有 30% 电量 🫨。\n\n5 分钟快充能再听 4 小时，凌晨赶飞机也不慌。卧室、公园、海边、帐篷都带着它，第一次觉得「不用焦虑找充电线」是这种快乐。",
      prompts:[
        "桌面氛围：奶油白音响放在木桌上，旁边是耳机和咖啡杯，斜射晨光，胶片质感",
        "户外露营：傍晚帐篷外，落日橘音响放在野餐布上，朋友们围坐，远景模糊",
      ],
      sources:[
        { file:"product_guide.pdf", at:"L10–L25 续航参数" },
      ],
      stats:{ tokens: 285, ms: 1240 },
      rating: 5,
    },
    {
      tag:"音质",
      angle:"5cm 全频 + 双被动振膜",
      hashtags:["#人声好听","#小巧大声","#音响平替"],
      body:"以为这么小一个最多就「能响」，结果一开机直接被低频按住——5cm 全频 + 双被动振膜，下潜 50Hz，唱口水歌都像在 LiveHouse。\n\n人声暖得离谱，听陈奕迅那种老歌，整个房间都柔了一档。",
      prompts:[
        "夜晚书桌特写：暖光台灯下音响发出声波涟漪可视化效果，背景虚化的乐谱",
        "音质对比：俯拍音响、JBL Clip、Sonos Roam 三只小音响并排，简洁背景",
      ],
      sources:[
        { file:"product_guide.pdf", at:"L42–L60 单元规格" },
      ],
      stats:{ tokens: 312, ms: 1380 },
      rating: 4,
    },
    {
      tag:"防护",
      angle:"IPX7 防水 + EVA 外壳",
      hashtags:["#泳池蓝牙音响","#雨天也能听","#耐造好物"],
      body:"上周带去泳池边，被熊孩子整桶水浇上去，我当时心都漏了一拍。\n\n擦干之后照样响，IPX7 不是开玩笑的。EVA 纺织外壳手感像羊毛毡，磕到桌角也没事。终于敢把音响真正「带出门」了。",
      prompts:[
        "泳池边场景：雾岩灰音响放在泳池边瓷砖上，溅起的水珠定格，正午阳光",
        "雨天窗台：奶油白音响放在窗台上，玻璃挂满雨珠，室内暖黄灯",
      ],
      sources:[
        { file:"product_guide.pdf",    at:"L88–L102 防护等级" },
        { file:"competitor_info.pdf",  at:"L45–L60 竞品对比"  },
      ],
      stats:{ tokens: 268, ms: 1180 },
      rating: 5,
    },
    {
      tag:"配色",
      angle:"奶油白 / 雾岩灰 / 落日橘",
      hashtags:["#ins风音响","#拍照出片","#桌面氛围感"],
      body:"颜色才是我入它的理由——奶油白配北欧家、雾岩灰随便摆都高级、落日橘往书架上一搁就是相机原片。\n\n表面 EVA 纺织有点像被磨毛过的羊毛毡，手指划上去很治愈。颜值这块真的拿捏。",
      prompts:[
        "三色 flat lay：奶油白、雾岩灰、落日橘三只音响 45° 俯拍，米色背景，杂志风",
        "落日橘 + 书架：落日橘音响放在原木书架上，旁边是植物和摄影集",
      ],
      sources:[
        { file:"product_guide.pdf", at:"L88–L102 配色与材质" },
      ],
      stats:{ tokens: 240, ms: 1010 },
      rating: 4,
    },
    {
      tag:"互联",
      angle:"双机互联 0.1s 配对",
      hashtags:["#露营神器","#立体声玩法","#朋友圈晒物"],
      body:"两个音响并联 0.1 秒就配对成功，露营时一台放食物边、一台放帐篷里，立体声场直接拉满。\n\n上次野餐放了一首《海阔天空》，朋友以为我背了个大音响，其实是两个 480g 的小可爱在 battle。",
      prompts:[
        "露营双机：黄昏野餐布上两只音响左右分立，朋友举杯，远景虚化",
        "客厅立体声：两只奶油白音响放在沙发两侧，电影画面投影在墙上",
      ],
      sources:[
        { file:"product_guide.pdf", at:"L120–L132 多机互联" },
      ],
      stats:{ tokens: 296, ms: 1260 },
      rating: 5,
    },
  ],
  cost: { embed: 0.02, llm: 0.15, total: 0.17, tokensIn: 4820, tokensOut: 1340 },
};

const PROJECT_CARDS = {
  intro: {
    title: "产品介绍",
    body: "Lumio Pulse 是 Lumio 推出的便携蓝牙音响系列旗舰，主打「24h 续航 × IPX7 防水 × 桌面氛围感」三个产品支点。整机重 480g，单手可握；标配 5cm 全频单元 + 被动低频振膜，低频下潜 50Hz；提供奶油白、雾岩灰、落日橘三种 ins 风配色。",
    chips: ["便携蓝牙音响","18–30 岁","桌面 / 户外","ins 风配色"],
  },
  compete: {
    title: "竞品分析",
    body: "对比头部竞品 JBL Clip 5 与 Sonos Roam，Lumio Pulse 在「续航 × 配色 × 价格」三角中找到差异化位置：续航优于 Clip 5 的 12h，配色比 Sonos 更年轻，价格控制在 599 元以内。劣势是品牌声量较弱，需要内容侧种草放大。",
    chips: ["差异化：续航/配色/价格","劣势：品牌声量","建议：内容种草放大"],
  }
};

const HISTORY = [
  { date:"2025-01-15", time:"14:23", q:"生成 5 个卖点及小红书笔记",        score: 4, edits: 2, cost: 0.17, tag:"营销文案",  preset:true },
  { date:"2025-01-15", time:"11:08", q:"对比竞品优势，生成差异化卖点",       score: 5, edits: 1, cost: 0.23, tag:"竞品分析",  preset:true },
  { date:"2025-01-14", time:"22:41", q:"为「落日橘」配色单独写一版微博文案", score: 4, edits: 0, cost: 0.11, tag:"自定义",     preset:false },
  { date:"2025-01-14", time:"17:55", q:"生成小红书、微博、抖音三端文案",     score: 5, edits: 3, cost: 0.31, tag:"多渠道",    preset:true },
  { date:"2025-01-13", time:"10:12", q:"给「奶油白」拍照场景写 6 个 prompt", score: 3, edits: 1, cost: 0.09, tag:"自定义",     preset:false },
  { date:"2025-01-12", time:"16:30", q:"产品使用场景故事 + 配图 prompt",     score: 4, edits: 2, cost: 0.19, tag:"场景化",    preset:true },
];

// helper for the bar fill animation
const clamp = (v, a=0, b=100) => Math.min(b, Math.max(a, v));

// 笔记库 — usable notes collected across past conversations.
// (Each note carries provenance + score so users can browse and reuse.)
const NOTE_LIBRARY = [
  { id:"n1", tag:"续航",   angle:"24h 长续航 + 快充",  channel:"小红书", style:"种草",    rating:5, uses:12, words:118, prompts:2, from:"2025-01-15 14:23", body:"周五下班顺手把它塞进通勤包，一路听到周日露营回来，居然还有 30% 电量 🫨…", hashtags:["#续航党狂喜","#带去露营"] },
  { id:"n2", tag:"音质",   angle:"5cm 全频 + 双振膜",  channel:"小红书", style:"种草",    rating:4, uses: 7, words:135, prompts:2, from:"2025-01-15 14:23", body:"以为这么小一个最多就「能响」，结果一开机直接被低频按住——",      hashtags:["#人声好听","#音响平替"] },
  { id:"n3", tag:"防护",   angle:"IPX7 + EVA 外壳",     channel:"小红书", style:"故事",    rating:5, uses:18, words:124, prompts:2, from:"2025-01-15 14:23", body:"上周带去泳池边，被熊孩子整桶水浇上去，我当时心都漏了一拍…",            hashtags:["#泳池神器","#雨天也能听"] },
  { id:"n4", tag:"配色",   angle:"奶油白 / 雾岩灰 / 落日橘", channel:"小红书", style:"出片",  rating:4, uses: 9, words:108, prompts:2, from:"2025-01-15 14:23", body:"颜色才是我入它的理由——奶油白配北欧家、雾岩灰随便摆都高级…",          hashtags:["#ins风音响","#桌面氛围感"] },
  { id:"n5", tag:"互联",   angle:"双机互联 0.1s",        channel:"小红书", style:"种草",   rating:5, uses:14, words:130, prompts:2, from:"2025-01-15 14:23", body:"两个音响并联 0.1 秒就配对成功，露营时一台放食物边、一台放帐篷里…",   hashtags:["#露营神器","#立体声玩法"] },
  { id:"n6", tag:"差异化", angle:"对比 JBL Clip 5",       channel:"微博",   style:"数据派", rating:5, uses: 6, words:96,  prompts:1, from:"2025-01-15 11:08", body:"同价位段 5 款蓝牙音响实测：续航 24h vs 12h，重量 480g vs 285g…",      hashtags:["#蓝牙音响测评"] },
  { id:"n7", tag:"配色",   angle:"落日橘单色专题",        channel:"微博",   style:"情感",   rating:4, uses: 3, words:88,  prompts:1, from:"2025-01-14 22:41", body:"夕阳从窗户斜进来的时候，落日橘音响和书桌融成一片，那种安静里有微光的感觉…", hashtags:["#落日橘"] },
  { id:"n8", tag:"多平台", angle:"三端文案合集",          channel:"抖音",   style:"口语",   rating:5, uses:11, words:142, prompts:3, from:"2025-01-14 17:55", body:"家人们！这个小音响绝对是宝藏，今天必须给你们扒一扒！",                  hashtags:["#蓝牙音响","#好物推荐"] },
  { id:"n9", tag:"场景化", angle:"使用场景故事 · 露营",   channel:"小红书", style:"故事",   rating:4, uses: 5, words:156, prompts:3, from:"2025-01-12 16:30", body:"那天我们扎营在山顶，风把云吹得很快。她从背包里拿出 Lumio，按下开关——",  hashtags:["#露营日记","#音乐与远方"] },
  { id:"n10",tag:"防护",   angle:"防水实测 vlog 文案",    channel:"抖音",   style:"测评",   rating:3, uses: 2, words:78,  prompts:1, from:"2025-01-13 10:12", body:"今天来个 IPX7 实测，把它扔进水里 30 分钟看看会怎样——",                hashtags:["#防水测试"] },
];

Object.assign(window, { PROJECTS, PRESET_QUESTIONS, THINKING_TRACE, GENERATED_RESULT, PROJECT_CARDS, HISTORY, NOTE_LIBRARY, clamp });
