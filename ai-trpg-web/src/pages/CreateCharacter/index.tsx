import { useState, useRef, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { apiUrl } from '../../config';
import './CreateCharacter.css';

// SECTION: 骰点工具
// NOTE: COC 7th 属性生成大量使用 D6，这里保持最小工具函数便于测试替换。
const rollD6 = () => Math.floor(Math.random() * 6) + 1;

// SECTION: 空属性模板
// NOTE: 属性值全部以 COC 百分制保存，0 表示尚未生成/填写。
const emptyStats = {
  str: 0, con: 0, siz: 0, dex: 0, app: 0, int: 0, pow: 0, edu: 0, luc: 0
};

// SECTION: 空背景模板
// NOTE: 背景字段直接持久化进 fullData，游戏页目前只读取基础/技能/资源。
const emptyBgInfo = {
  description: '', belief: '', importantPerson: '', meaningfulPlace: '',
  treasuredItem: '', traits: '', scars: '', phobias: '', history: '', credit: '', wealth: ''
};

export default function CreateCharacter() {
  const navigate = useNavigate();
  const location = useLocation();

  // SECTION: 编辑模式入口
  // NOTE: Lobby 点击编辑时通过 navigate state 传入整张角色摘要和 fullData。
  const editData = location.state?.character;

  // SECTION: 页面页签与基础资料
  // NOTE: 新建时使用默认空值，编辑时优先回填旧角色的 fullData.basicInfo。
  const [activeTab, setActiveTab] = useState('skills');
  const [basicInfo, setBasicInfo] = useState(editData?.fullData?.basicInfo || {
    name: '', age: 20, gender: '', era: '1920s', 
    residence: '', hometown: '', occupation: ''
  });

  // SECTION: 头像上传状态
  // NOTE: 头像目前只在本页预览，尚未进入持久化数据结构。
  const [avatar, setAvatar] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // SECTION: 属性生成模式
  // NOTE: roll 是传统随机，buy 是购点；两种模式共用同一份 stats。
  const [statMode, setStatMode] = useState<'roll' | 'buy'>('roll');
  const [buyLimit, setBuyLimit] = useState(480);
  const [stats, setStats] = useState<Record<string, number>>({
    ...emptyStats,
    ...(editData?.fullData?.stats || {})
  });

  // SECTION: 派生资源
  // NOTE: SAN 初始值等于 POW；HP/MP 在后端摘要中按 CON/SIZ/POW 派生。
  const san = stats.pow;
  // NOTE: COC 7th 移动力按 DEX/STR 与 SIZ 的比较决定。
  const move = stats.dex < stats.siz && stats.str < stats.siz ? 7 : stats.dex > stats.siz && stats.str > stats.siz ? 9 : 8;

  // SECTION: 伤害加值与体格
  // NOTE: DB/build 由 STR + SIZ 区间推导，显示用，不直接保存到后端摘要。
  const strSizSum = stats.str + stats.siz;
  let db = "0", build = 0;
  if (strSizSum >= 2 && strSizSum <= 64) { db = "-2"; build = -2; }
  else if (strSizSum >= 65 && strSizSum <= 84) { db = "-1"; build = -1; }
  else if (strSizSum >= 85 && strSizSum <= 124) { db = "0"; build = 0; }
  else if (strSizSum >= 125 && strSizSum <= 164) { db = "+1D4"; build = 1; }
  else if (strSizSum >= 165) { db = "+1D6"; build = 2; }

  // SECTION: 购点预算
  // NOTE: 当前购点模式把 LUC 也计入 spentStatPoints；UI 文案提示 LUC 可按房规单独处理。
  const spentStatPoints = stats.str + stats.con + stats.siz + stats.dex + stats.app + stats.int + stats.pow + stats.edu;
  const remainStatPoints = buyLimit - spentStatPoints;

  // SECTION: 默认技能表
  // NOTE: 这里存 COC 常用技能初始值，后续可以抽到独立配置文件或后端规则包。
  const defaultSkills = [
    { id: 's1', name: '会计 (Accounting)', base: 5, job: 0, interest: 0, grow: 0 },
    { id: 's2', name: '人类学 (Anthropology)', base: 1, job: 0, interest: 0, grow: 0 },
    { id: 's3', name: '估价 (Appraise)', base: 5, job: 0, interest: 0, grow: 0 },
    { id: 's4', name: '考古学 (Archaeology)', base: 1, job: 0, interest: 0, grow: 0 },
    { id: 's5', name: '魅惑 (Charm)', base: 15, job: 0, interest: 0, grow: 0 },
    { id: 's6', name: '攀爬 (Climb)', base: 20, job: 0, interest: 0, grow: 0 },
    { id: 's7', name: '计算机使用 (Computer Use)', base: 5, job: 0, interest: 0, grow: 0 },
    { id: 's8', name: '信用评级 (Credit Rating)', base: 0, job: 0, interest: 0, grow: 0 },
    { id: 's9', name: '乔装 (Disguise)', base: 5, job: 0, interest: 0, grow: 0 },
    { id: 's10', name: '闪避 (Dodge)', base: Math.floor(stats.dex / 2) || 0, job: 0, interest: 0, grow: 0 },
    { id: 's11', name: '驾驶 (Drive Auto)', base: 20, job: 0, interest: 0, grow: 0 },
    { id: 's12', name: '电气维修 (Electrical Repair)', base: 10, job: 0, interest: 0, grow: 0 },
    { id: 's13', name: '话术 (Fast Talk)', base: 5, job: 0, interest: 0, grow: 0 },
    { id: 's14', name: '斗殴 (Fighting: Brawl)', base: 25, job: 0, interest: 0, grow: 0 },
    { id: 's15', name: '射击:手枪 (Firearms: Handgun)', base: 20, job: 0, interest: 0, grow: 0 },
    { id: 's16', name: '急救 (First Aid)', base: 30, job: 0, interest: 0, grow: 0 },
    { id: 's17', name: '历史 (History)', base: 5, job: 0, interest: 0, grow: 0 },
    { id: 's18', name: '恐吓 (Intimidate)', base: 15, job: 0, interest: 0, grow: 0 },
    { id: 's19', name: '母语 (Language Own)', base: stats.edu || 0, job: 0, interest: 0, grow: 0 },
    { id: 's20', name: '法律 (Law)', base: 5, job: 0, interest: 0, grow: 0 },
    { id: 's21', name: '图书馆使用 (Library Use)', base: 20, job: 0, interest: 0, grow: 0 },
    { id: 's22', name: '聆听 (Listen)', base: 20, job: 0, interest: 0, grow: 0 },
    { id: 's23', name: '机械维修 (Mechanical Repair)', base: 10, job: 0, interest: 0, grow: 0 },
    { id: 's24', name: '医学 (Medicine)', base: 1, job: 0, interest: 0, grow: 0 },
    { id: 's25', name: '博物学 (Natural World)', base: 10, job: 0, interest: 0, grow: 0 },
    { id: 's26', name: '领航 (Navigate)', base: 10, job: 0, interest: 0, grow: 0 },
    { id: 's27', name: '秘教 (Occult)', base: 5, job: 0, interest: 0, grow: 0 },
    { id: 's28', name: '劝说 (Persuade)', base: 10, job: 0, interest: 0, grow: 0 },
    { id: 's29', name: '心理学 (Psychology)', base: 10, job: 0, interest: 0, grow: 0 },
    { id: 's30', name: '侦查 (Spot Hidden)', base: 25, job: 0, interest: 0, grow: 0 },
    { id: 's31', name: '潜行 (Stealth)', base: 20, job: 0, interest: 0, grow: 0 },
    { id: 's32', name: '投掷 (Throw)', base: 20, job: 0, interest: 0, grow: 0 }
  ];

  // SECTION: 技能状态
  // NOTE: 编辑时优先使用旧卡 skills；新建时使用默认技能模板。
  const [skills, setSkills] = useState<any[]>(editData?.fullData?.skills || defaultSkills);

  // SECTION: 属性联动技能
  // NOTE: 闪避基础值依赖 DEX，母语基础值依赖 EDU；属性改动后自动刷新。
  useEffect(() => {
    setSkills(prev => prev.map(s => {
      if (s.name.includes('闪避')) return { ...s, base: Math.floor(stats.dex / 2) || 0 };
      if (s.name.includes('母语')) return { ...s, base: stats.edu || 0 };
      return s;
    }));
  }, [stats.dex, stats.edu]);

  // SECTION: 技能字段更新
  // NOTE: 技能名保持字符串，点数字段统一转 number，空输入视为 0。
  const updateSkill = (id: string, field: string, value: string | number) => {
    setSkills(skills.map(s => {
      if (s.id !== id) return s;
      if (field === 'name') return { ...s, name: String(value) };
      return { ...s, [field]: Number(value) || 0 };
    }));
  };

  // SECTION: 自定义技能
  // NOTE: custom_ 前缀用于渲染时判断是否允许编辑初始值和删除。
  const addCustomSkill = () => {
    setSkills([...skills, { 
      id: `custom_${Date.now()}`, name: '', base: 1, job: 0, interest: 0, grow: 0 
    }]);
  };

  // SECTION: 删除自定义技能
  // NOTE: 默认技能不提供删除按钮，所以这里主要服务 custom_ 技能。
  const removeSkill = (id: string) => {
    setSkills(skills.filter(s => s.id !== id));
  };

  // SECTION: 技能点预算
  // NOTE: 本职点按 EDU*4，兴趣点按 INT*2；保存前会阻止透支。
  const totalJobPoints = stats.edu * 4;
  const totalIntPoints = stats.int * 2;
  const spentJob = skills.reduce((sum, s) => sum + (s.job || 0), 0);
  const spentInt = skills.reduce((sum, s) => sum + (s.interest || 0), 0);
  const remainJob = totalJobPoints - spentJob;
  const remainInt = totalIntPoints - spentInt;

  // SECTION: 背景资料
  // NOTE: 背景资料只影响角色档案展示，不参与当前自动判定逻辑。
  const [bgInfo, setBgInfo] = useState({
    ...emptyBgInfo,
    ...(editData?.fullData?.bgInfo || {})
  });

  // SECTION: 头像预览上传
  // NOTE: FileReader 转 base64 只供本地预览；后续若持久化应改为对象存储或后端上传。
  const handleAvatarUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => setAvatar(reader.result as string);
      reader.readAsDataURL(file);
    }
  };

  // SECTION: 随机生成属性
  // NOTE: STR/CON/DEX/APP/POW/LUC 用 3D6*5，SIZ/INT/EDU 用 (2D6+6)*5。
  const handleRollAll = () => {
    setStats({
      str: (rollD6() + rollD6() + rollD6()) * 5,
      con: (rollD6() + rollD6() + rollD6()) * 5,
      dex: (rollD6() + rollD6() + rollD6()) * 5,
      app: (rollD6() + rollD6() + rollD6()) * 5,
      pow: (rollD6() + rollD6() + rollD6()) * 5,
      siz: (rollD6() + rollD6() + 6) * 5,
      int: (rollD6() + rollD6() + 6) * 5,
      edu: (rollD6() + rollD6() + 6) * 5,
      luc: (rollD6() + rollD6() + rollD6()) * 5,
    });
  };

  // SECTION: 保存角色卡
  // NOTE: 保存前做最小完整性校验；更复杂的房规校验后续可集中到后端。
  const handleSave = async () => {
    if (!basicInfo.name || stats.str === 0) return alert('请至少填写姓名并检定核心属性！');
    if (remainJob < 0 || remainInt < 0) return alert('技能点数已透支，请检查加点！');
    const username = localStorage.getItem('trpg_username'); 
    if (!username) return alert('警告：未检测到登录账号信息，请先返回登录页！');

    // NOTE: editData?.id 决定后端是更新旧角色还是创建新角色。
    const finalCharacterData = { 
      id: editData?.id, 
      basicInfo, stats, skills, bgInfo 
    };

    try {
      const response = await fetch(apiUrl('/api/characters'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          username: username, 
          cardData: finalCharacterData 
        })
      });

      const result = await response.json();

      if (result.success) {
        alert(`调查员 [${basicInfo.name}] 档案已成功刻录进星舰数据库！`);
        navigate(-1);
      } else {
        alert(`保存失败: ${result.message}`);
      }
    } catch (error) {
      console.error('API 请求报错:', error);
      alert('网络连接断开，无法访问星舰服务器！');
    }
  };

  return (
    <div className="create-char-container">
      <div className="char-workspace">
        <div className="char-sidebar flat-box">
          <div className="sidebar-top">
            <h2 className="sidebar-title">
              {editData ? '编辑调查员档案' : '新建调查员档案'}<br/>
              <span className="highlight-text" style={{ fontSize: '1rem' }}>[COC 7th]</span>
            </h2>
            {/* SECTION: 编辑页签 */}
            {/* NOTE: 三个页签共享同一份角色状态，切换不会丢失未保存输入。 */}
            <div className="sidebar-tabs">
              <button className={`tab-btn ${activeTab === 'basic' ? 'active' : ''}`} onClick={() => setActiveTab('basic')}>基本信息</button>
              <button className={`tab-btn ${activeTab === 'skills' ? 'active' : ''}`} onClick={() => setActiveTab('skills')}>职业与技能</button>
              <button className={`tab-btn ${activeTab === 'background' ? 'active' : ''}`} onClick={() => setActiveTab('background')}>背景与资产</button>
            </div>
          </div>
          <div className="sidebar-bottom">
            <button className="flat-btn primary" onClick={handleSave}>💾 录入数据库</button>
            <button className="flat-btn secondary" onClick={() => navigate(-1)}>放弃并返回</button>
          </div>
        </div>
        <div className="char-main-area flat-box">
          {activeTab === 'basic' && (
            <>
              {/* SECTION: 基础身份页 */}
              {/* NOTE: 姓名是游戏内唯一展示名，也是 ROLL 指令匹配的目标名。 */}
              <h3 className="section-title">调查员身份录入</h3>
              <div style={{ display: 'flex', gap: '30px' }}>
                <div className="avatar-upload-box" onClick={() => fileInputRef.current?.click()}>
                  <input type="file" ref={fileInputRef} hidden accept="image/*" onChange={handleAvatarUpload} />
                  {avatar ? <img src={avatar} alt="Avatar" className="avatar-preview" /> : <div className="upload-placeholder"><span>+</span><p>上传立绘照片</p></div>}
                </div>
                <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '15px' }}>
                  <div className="form-row" style={{ marginTop: 0 }}>
                    <div className="form-item"><label>姓名</label><input type="text" className="flat-input" value={basicInfo.name} onChange={e=>setBasicInfo({...basicInfo, name: e.target.value})} /></div>
                    <div className="form-item small"><label>年龄</label><input type="number" className="flat-input" value={basicInfo.age} onChange={e=>setBasicInfo({...basicInfo, age: Number(e.target.value)})} /></div>
                    <div className="form-item small"><label>性别</label><input type="text" className="flat-input" value={basicInfo.gender} onChange={e=>setBasicInfo({...basicInfo, gender: e.target.value})} /></div>
                  </div>
                  <div className="form-row" style={{ marginTop: 0 }}>
                    <div className="form-item small"><label>时代</label><input type="text" className="flat-input" value={basicInfo.era} onChange={e=>setBasicInfo({...basicInfo, era: e.target.value})} /></div>
                    <div className="form-item"><label>住地</label><input type="text" className="flat-input" value={basicInfo.residence} onChange={e=>setBasicInfo({...basicInfo, residence: e.target.value})} /></div>
                    <div className="form-item"><label>故乡</label><input type="text" className="flat-input" value={basicInfo.hometown} onChange={e=>setBasicInfo({...basicInfo, hometown: e.target.value})} /></div>
                  </div>
                  <div style={{ display: 'flex', gap: '15px', marginTop: '10px', background: '#FAF5F7', padding: '15px', borderRadius: '4px', border: '1.5px solid #EFE6E8' }}>
                    <div style={{ flex: 1, textAlign: 'center' }}><div className="stat-label">移动力</div><div className="stat-value">{move}</div></div>
                    <div style={{ flex: 1, textAlign: 'center' }}><div className="stat-label">伤害加值(DB)</div><div className="stat-value" style={{ fontSize: '20px' }}>{stats.str===0 ? '-' : db}</div></div>
                    <div style={{ flex: 1, textAlign: 'center' }}><div className="stat-label">体格(Build)</div><div className="stat-value">{stats.str===0 ? '-' : build}</div></div>
                    <div style={{ flex: 1, textAlign: 'center' }}><div className="stat-label">理智(SAN)</div><div className="stat-value" style={{ color: '#FF8FAB' }}>{san || '-'}</div></div>
                  </div>
                </div>
              </div>
              <div style={{ marginTop: '20px', borderTop: '1.5px dashed #EFE6E8', paddingTop: '20px' }}>
                
                <div className="stat-mode-header">
                  <div>
                    <h3 className="section-title" style={{ border: 'none', margin: 0, padding: 0 }}>基础属性生成</h3>
                        <div className="mode-toggle" style={{ display: 'flex', flexDirection: 'row', gap: '10px' }}>
                        <button 
                            className={`flat-btn small ${statMode === 'roll' ? 'primary' : 'secondary'}`} 
                            style={{ whiteSpace: 'nowrap', padding: '10px 20px' }} 
                            onClick={() => setStatMode('roll')}
                        >
                            随机投掷
                        </button>
                        <button 
                            className={`flat-btn small ${statMode === 'buy' ? 'primary' : 'secondary'}`} 
                            style={{ whiteSpace: 'nowrap', padding: '10px 20px' }} 
                            onClick={() => setStatMode('buy')}
                        >
                            购点模式
                        </button>
                        </div>
                  </div>
                  {statMode === 'roll' ? (
                    <button className="flat-btn primary small btn-short" onClick={handleRollAll}>🎲 随机投掷全属性</button>
                  ) : (
                    <div className="point-buy-control">
                      <label style={{ fontSize: '0.85rem', fontWeight: 'bold', color: '#A0858D' }}>购点上限(不含LUC):</label>
                      <input type="number" className="flat-input" style={{ width: '80px', padding: '5px 10px', height: '30px' }} value={buyLimit} onChange={e => setBuyLimit(Number(e.target.value))} />
                      <span style={{ fontSize: '0.9rem', fontWeight: 'bold' }}>剩余点数: <span className={remainStatPoints < 0 ? 'error-text' : ''} style={{ fontSize: '1.2rem', color: '#FF8FAB' }}>{remainStatPoints}</span></span>
                    </div>
                  )}
                </div>
                {/* SECTION: 属性生成说明 */}
                {/* NOTE: 说明文案跟随 statMode 切换，减少用户误解购点和随机的差异。 */}
                <div className="info-box">
                  {statMode === 'roll' 
                    ? "【投掷规则】传统 COC 跑团的精髓，由命运决定你的天赋！点击按钮将使用 3D6×5 的标准规则生成属性。"
                    : "【购点规则】现代网团常用的平衡模式。输入房主规定的总点数上限，在下方手动输入分配属性值。建议单项属性控制在 15~90 之间。※ 幸运(LUC)通常需单独投掷，不计入总点数。"}
                </div>
                <div className="stats-grid">
                    {Object.entries(stats).map(([key, val]) => (
                        <div key={key} className="stat-box">
                        <div className="stat-label">{key.toUpperCase()}</div>
                        <div className="stat-display-wrapper">
                            {statMode === 'buy' ? (
                            <input 
                                type="number" 
                                className="stat-input" 
                                value={val || ''} 
                                onChange={e => setStats({...stats, [key]: Number(e.target.value)})} 
                                placeholder="-"
                            />
                            ) : (
                            <div className={val>=75?'high':val>0&&val<=40?'low':'normal'}>{val || '-'}</div>
                            )}
                        </div>
                        {statMode === 'buy' && key === 'luc' && (
                            <button 
                            className="flat-btn secondary small luc-dice-btn" 
                            onClick={() => setStats({...stats, luc: rollD6() * 5})}
                            >
                            🎲
                            </button>
                        )}
                        
                        </div>
                    ))}
                    <div className="attr-desc-box">
                        <p><b>属性释义：</b> STR(力量): 爆发力与伤害；CON(体质): 耐力与生命；SIZ(体型): 生命与体格；DEX(敏捷): 反应速度；APP(外貌): 魅力；INT(智力): 学习力；POW(意志): 精神抗性与魔力；EDU(教育): 知识储备；LUC(幸运): 决定命运的眷顾。</p>
                    </div>  
                    </div>
                                  
              </div>
            </>
          )}
          {activeTab === 'skills' && (
            <>
              {/* SECTION: 职业与技能页 */}
              {/* NOTE: 技能总成功率 = 初始值 + 职业投入 + 兴趣投入 + 成长。 */}
              <h3 className="section-title">职业信息与技能配置</h3>

              <div className="form-row" style={{ marginTop: 0 }}>
                <div className="form-item">
                  <label>所选职业</label>
                  <input type="text" className="flat-input" value={basicInfo.occupation} onChange={e=>setBasicInfo({...basicInfo, occupation: e.target.value})} placeholder="例如：私家侦探..." />
                </div>
                <div className="form-item">
                  <label>本职点数 (剩余 / 总计)</label>
                  <div className="flat-input" style={{ display: 'flex', justifyContent: 'space-between', background: '#EFE6E8' }}>
                    <span className={`stat-highlight ${remainJob < 0 ? 'error-text' : ''}`}>{remainJob}</span>
                    <span style={{ color: '#A0858D' }}>/ {totalJobPoints}</span>
                  </div>
                </div>
                <div className="form-item">
                  <label>兴趣点数 (剩余 / 总计)</label>
                  <div className="flat-input" style={{ display: 'flex', justifyContent: 'space-between', background: '#EFE6E8' }}>
                    <span className={`stat-highlight ${remainInt < 0 ? 'error-text' : ''}`}>{remainInt}</span>
                    <span style={{ color: '#A0858D' }}>/ {totalIntPoints}</span>
                  </div>
                </div>
              </div>

              <div style={{ marginTop: '20px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
                  <span style={{ fontSize: '0.85rem', color: '#A0858D' }}>※ 分配点数不能超过剩余点数，总成功率将自动计算。</span>
                  <button className="flat-btn secondary small" onClick={addCustomSkill}>+ 添加自定义技能</button>
                </div>

                {/* SECTION: 技能表格 */}
                {/* NOTE: 自定义技能可编辑名称和初始值，系统技能只允许分配点数。 */}
                <div className="skill-table-container">
                <table className="skill-table">
                  <thead>
                    <tr>
                      <th style={{ textAlign: 'left' }}>技能名称</th>
                      <th>初始值</th><th>职业投入</th><th>兴趣投入</th><th>成长</th>
                      <th style={{ color: '#FF8FAB' }}>总成功率</th>
                      <th>操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {skills.map(skill => {
                      const total = skill.base + skill.job + skill.interest + skill.grow;
                      const isCustom = skill.id.startsWith('custom_');
                      return (
                        <tr key={skill.id}>
                          <td style={{ textAlign: 'left' }}>
                            {isCustom ? (
                              <input type="text" className="flat-input skill-input text" placeholder="输入技能名" value={skill.name} onChange={e => updateSkill(skill.id, 'name', e.target.value)} />
                            ) : skill.name}
                          </td>
                          <td>
                            {isCustom ? (
                              <input type="number" className="flat-input skill-input" value={skill.base} onChange={e => updateSkill(skill.id, 'base', e.target.value)} />
                            ) : skill.base}
                          </td>
                          <td><input type="number" className="flat-input skill-input" value={skill.job || ''} onChange={e => updateSkill(skill.id, 'job', e.target.value)} placeholder="0" /></td>
                          <td><input type="number" className="flat-input skill-input" value={skill.interest || ''} onChange={e => updateSkill(skill.id, 'interest', e.target.value)} placeholder="0" /></td>
                          <td><input type="number" className="flat-input skill-input" value={skill.grow || ''} onChange={e => updateSkill(skill.id, 'grow', e.target.value)} placeholder="0" /></td>
                          <td style={{ color: '#FF8FAB', fontWeight: '900', fontSize: '1.1rem' }}>{total}</td>
                          <td>
                            {isCustom ? <button className="flat-btn secondary small" style={{ padding: '0 8px', height: '30px' }} onClick={() => removeSkill(skill.id)}>删除</button> : <span style={{ color: '#EFE6E8' }}>-</span>}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>      
              </div>
            </>
          )}
          {activeTab === 'background' && (
            <div style={{ display: 'flex', gap: '30px' }}>
              {/* SECTION: 背景故事页 */}
              {/* NOTE: 背景字段为玩家手写文本，不参与当前 AI 自动检定。 */}
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '15px' }}>
                <h3 className="section-title">故事背景</h3>
                <div className="form-item"><label>个人描述</label><textarea className="flat-input" value={bgInfo.description} onChange={e=>setBgInfo({...bgInfo, description: e.target.value})}></textarea></div>
                <div className="form-item"><label>思想与信念</label><textarea className="flat-input" value={bgInfo.belief} onChange={e=>setBgInfo({...bgInfo, belief: e.target.value})}></textarea></div>
                <div className="form-item"><label>重要之人</label><textarea className="flat-input" value={bgInfo.importantPerson} onChange={e=>setBgInfo({...bgInfo, importantPerson: e.target.value})}></textarea></div>
                <div className="form-item"><label>恐惧症与狂躁症</label><textarea className="flat-input" value={bgInfo.phobias} onChange={e=>setBgInfo({...bgInfo, phobias: e.target.value})}></textarea></div>
              </div>

              {/* SECTION: 资产与经历页 */}
              {/* NOTE: 信用评级字段可与技能表中的 Credit Rating 分开记录具体资产说明。 */}
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '15px' }}>
                <h3 className="section-title">资产与经历</h3>
                <div className="form-row" style={{ marginTop: 0 }}>
                  <div className="form-item"><label>信用评级 (Credit)</label><input type="text" className="flat-input" value={bgInfo.credit} onChange={e=>setBgInfo({...bgInfo, credit: e.target.value})} placeholder="例如：45" /></div>
                  <div className="form-item"><label>现金与资产</label><input type="text" className="flat-input" value={bgInfo.wealth} onChange={e=>setBgInfo({...bgInfo, wealth: e.target.value})} placeholder="例如：$500" /></div>
                </div>
                <div className="form-item"><label>调查员经历与模组记录</label><textarea className="flat-input" style={{ minHeight: '180px' }} value={bgInfo.history} onChange={e=>setBgInfo({...bgInfo, history: e.target.value})} placeholder="例如：经历模组【桃花岛】，-5 SAN，+3 侦查..."></textarea></div>
              </div>
            </div>
          )}

        </div>
      </div>
    </div>
  );
}
