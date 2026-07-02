import { useState, useRef, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { apiUrl } from '../../config';
import './CreateCharacter.css';

const rollD6 = () => Math.floor(Math.random() * 6) + 1;

const emptyStats = {
  str: 0, con: 0, siz: 0, dex: 0, app: 0, int: 0, pow: 0, edu: 0, luc: 0
};

const emptyBgInfo = {
  description: '', belief: '', importantPerson: '', meaningfulPlace: '',
  treasuredItem: '', traits: '', scars: '', phobias: '', history: '', credit: '', wealth: ''
};

export default function CreateCharacter() {
  const navigate = useNavigate();
  const location = useLocation();
  const editData = location.state?.character;

  // 侧边栏导航状态
  const [activeTab, setActiveTab] = useState('skills'); // 方便你测试，默认打开技能页签

  // --- 1. 基本信息状态 ---
  const [basicInfo, setBasicInfo] = useState(editData?.fullData?.basicInfo || {
    name: '', age: 20, gender: '', era: '1920s', 
    residence: '', hometown: '', occupation: ''
  });

  const [avatar, setAvatar] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // --- 属性生成模式状态 ---
  const [statMode, setStatMode] = useState<'roll' | 'buy'>('roll'); // 'roll' 投掷, 'buy' 购点
  const [buyLimit, setBuyLimit] = useState(480); // 购点上限，默认常见村规480点（不含幸运）

  // --- 2. 属性状态 ---
  const [stats, setStats] = useState<Record<string, number>>({
    ...emptyStats,
    ...(editData?.fullData?.stats || {})
  });

  //const hp = Math.floor((stats.con + stats.siz) / 10);
  //const mp = Math.floor(stats.pow / 5);
  const san = stats.pow;
  //const dodge = Math.floor(stats.dex / 2);
  const move = stats.dex < stats.siz && stats.str < stats.siz ? 7 : stats.dex > stats.siz && stats.str > stats.siz ? 9 : 8;
  
  const strSizSum = stats.str + stats.siz;
  let db = "0", build = 0;
  if (strSizSum >= 2 && strSizSum <= 64) { db = "-2"; build = -2; }
  else if (strSizSum >= 65 && strSizSum <= 84) { db = "-1"; build = -1; }
  else if (strSizSum >= 85 && strSizSum <= 124) { db = "0"; build = 0; }
  else if (strSizSum >= 125 && strSizSum <= 164) { db = "+1D4"; build = 1; }
  else if (strSizSum >= 165) { db = "+1D6"; build = 2; }

  // --- 新增：计算购点模式下的已花费点数 (通常不包含幸运，但这里为你提供全计算) ---
  const spentStatPoints = stats.str + stats.con + stats.siz + stats.dex + stats.app + stats.int + stats.pow + stats.edu;
  const remainStatPoints = buyLimit - spentStatPoints;

  // 1. 准备全量 COC 7th 常用技能库
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

  const [skills, setSkills] = useState<any[]>(editData?.fullData?.skills || defaultSkills);

  // 2. 核心逻辑：当敏捷(DEX)或教育(EDU)改变时，自动重新计算闪避和母语的初始值
  useEffect(() => {
    setSkills(prev => prev.map(s => {
      if (s.name.includes('闪避')) return { ...s, base: Math.floor(stats.dex / 2) || 0 };
      if (s.name.includes('母语')) return { ...s, base: stats.edu || 0 };
      return s;
    }));
  }, [stats.dex, stats.edu]);

  // 技能操作逻辑
  const updateSkill = (id: string, field: string, value: string | number) => {
    setSkills(skills.map(s => {
      if (s.id !== id) return s;
      if (field === 'name') return { ...s, name: String(value) };
      return { ...s, [field]: Number(value) || 0 };
    }));
  };

  const addCustomSkill = () => {
    setSkills([...skills, { 
      id: `custom_${Date.now()}`, name: '', base: 1, job: 0, interest: 0, grow: 0 
    }]);
  };

  const removeSkill = (id: string) => {
    setSkills(skills.filter(s => s.id !== id));
  };

  // 动态计算剩余点数
  const totalJobPoints = stats.edu * 4;
  const totalIntPoints = stats.int * 2;
  const spentJob = skills.reduce((sum, s) => sum + (s.job || 0), 0);
  const spentInt = skills.reduce((sum, s) => sum + (s.interest || 0), 0);
  const remainJob = totalJobPoints - spentJob;
  const remainInt = totalIntPoints - spentInt;

  // --- 4. 背景与资产状态 ---
  const [bgInfo, setBgInfo] = useState({
    ...emptyBgInfo,
    ...(editData?.fullData?.bgInfo || {})
  });

  const handleAvatarUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => setAvatar(reader.result as string);
      reader.readAsDataURL(file);
    }
  };

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

  // 【替换为以下代码】
  const handleSave = async () => {
    // 1. 基础校验
    if (!basicInfo.name || stats.str === 0) return alert('请至少填写姓名并检定核心属性！');
    if (remainJob < 0 || remainInt < 0) return alert('技能点数已透支，请检查加点！');
    
    // 2. 身份校验（从 localStorage 获取当前登录的账号）
    const username = localStorage.getItem('trpg_username'); 
    if (!username) return alert('警告：未检测到登录账号信息，请先返回登录页！');

    // 3. 组装终极数据包 (加上 editData 的 id 确保覆盖更新)
    const finalCharacterData = { 
      id: editData?.id, 
      basicInfo, stats, skills, bgInfo 
    };
    
    try {
      // 4. 发送给 Node.js 后端
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
        navigate(-1); // 成功后返回大厅
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
        
        {/* ================= 左侧：固定侧边栏 ================= */}
        <div className="char-sidebar flat-box">
          <div className="sidebar-top">
            <h2 className="sidebar-title">
              {editData ? '编辑调查员档案' : '新建调查员档案'}<br/>
              <span className="highlight-text" style={{ fontSize: '1rem' }}>[COC 7th]</span>
            </h2>
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

        {/* ================= 右侧：内容工作区 ================= */}
        <div className="char-main-area flat-box">
          
          {/* TAB 1: 基本信息 */}
          {activeTab === 'basic' && (
            <>
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

              {/* 基础属性生成 (双模式) */}
              <div style={{ marginTop: '20px', borderTop: '1.5px dashed #EFE6E8', paddingTop: '20px' }}>
                
                <div className="stat-mode-header">
                  <div>
                    <h3 className="section-title" style={{ border: 'none', margin: 0, padding: 0 }}>基础属性生成</h3>
                    {/* 将原来的 mode-toggle 替换为以下代码 */}
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

                  {/* 右侧操作区：根据模式不同显示不同内容 */}
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

                {/* 萌新讲解小贴士 */}
                <div className="info-box">
                  {statMode === 'roll' 
                    ? "【投掷规则】传统 COC 跑团的精髓，由命运决定你的天赋！点击按钮将使用 3D6×5 的标准规则生成属性。"
                    : "【购点规则】现代网团常用的平衡模式。输入房主规定的总点数上限，在下方手动输入分配属性值。建议单项属性控制在 15~90 之间。※ 幸运(LUC)通常需单独投掷，不计入总点数。"}
                </div>
                <div className="stats-grid">
                    {Object.entries(stats).map(([key, val]) => (
                        <div key={key} className="stat-box">
                        <div className="stat-label">{key.toUpperCase()}</div>
                        
                        {/* 统一的显示层 */}
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

                        {/* 幸运专属：右上角骰子 */}
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

          {/* TAB 2: 动态职业与技能 */}
          {activeTab === 'skills' && (
            <>
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

          {/* TAB 3: 背景与资产 */}
          {activeTab === 'background' && (
            <div style={{ display: 'flex', gap: '30px' }}>
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '15px' }}>
                <h3 className="section-title">故事背景</h3>
                <div className="form-item"><label>个人描述</label><textarea className="flat-input" value={bgInfo.description} onChange={e=>setBgInfo({...bgInfo, description: e.target.value})}></textarea></div>
                <div className="form-item"><label>思想与信念</label><textarea className="flat-input" value={bgInfo.belief} onChange={e=>setBgInfo({...bgInfo, belief: e.target.value})}></textarea></div>
                <div className="form-item"><label>重要之人</label><textarea className="flat-input" value={bgInfo.importantPerson} onChange={e=>setBgInfo({...bgInfo, importantPerson: e.target.value})}></textarea></div>
                <div className="form-item"><label>恐惧症与狂躁症</label><textarea className="flat-input" value={bgInfo.phobias} onChange={e=>setBgInfo({...bgInfo, phobias: e.target.value})}></textarea></div>
              </div>
              
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
