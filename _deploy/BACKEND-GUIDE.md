# 🦞 MEMEBUDDY 后端部署指南 — Cloudflare Workers + KV

## 第一步：创建 Cloudflare Worker

1. 打开 https://dash.cloudflare.com
2. 左侧菜单 → **Workers & Pages** → **Create**
3. 选择 **Create Worker**
4. 名字填 `memebuddy-api`
5. 点 **Deploy**
6. 点 **Edit Code**，把 `api.js` 的内容全部粘贴进去
7. 点 **Save and Deploy**

## 第二步：绑定 KV 存储

1. 左侧菜单 → **Workers & Pages** → **KV** → **Create a namespace**
2. 名字填 `MEMEBUDDY_KV`
3. 回到 Worker → **Settings** → **Bindings** → **Add**
   - Variable name: `MEME_KV`
   - KV namespace: 选择刚才创建的 `MEMEBUDDY_KV`
4. **Save**

## 第三步：测试 API

Worker 部署后会有一个 URL，类似：
```
https://memebuddy-api.你的子域名.workers.dev
```

测试命令（用你的实际 URL）：

```bash
# 提交钱包（+1 次）
curl -X POST https://memebuddy-api.xxx.workers.dev/api/submit \
  -H "Content-Type: application/json" \
  -d '{"type":"wallet","value":"0x1234...abcd","spins":1}'

# 提交邮箱（+2 次）
curl -X POST https://memebuddy-api.xxx.workers.dev/api/submit \
  -H "Content-Type: application/json" \
  -d '{"type":"email","value":"test@example.com","spins":2}'

# 查询次数
curl https://memebuddy-api.xxx.workers.dev/api/spins?user=0x1234...abcd

# 抽奖
curl -X POST https://memebuddy-api.xxx.workers.dev/api/spin \
  -H "Content-Type: application/json" \
  -d '{"user":"0x1234...abcd"}'

# 每日登录
curl -X POST https://memebuddy-api.xxx.workers.dev/api/daily \
  -H "Content-Type: application/json" \
  -d '{"user":"0x1234...abcd"}'

# 全局统计
curl https://memebuddy-api.xxx.workers.dev/api/stats
```

## 第四步：在 index.html 中接入 API

修改前端代码，将所有本地操作改为调用 API：

```javascript
// 替换 handleSubmit() 中的本地逻辑
async function handleSubmit() {
    const input = document.getElementById('wallet-input');
    const value = input.value.trim();
    
    if (!value) {
        alert('Please enter a wallet address or email');
        return;
    }
    
    const isEmail = value.includes('@');
    
    const res = await fetch('https://memebuddy-api.xxx.workers.dev/api/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            type: isEmail ? 'email' : 'wallet',
            value: value,
            spins: isEmail ? 2 : 1
        })
    });
    
    const data = await res.json();
    
    if (data.success) {
        currentUserId = isEmail ? `email:${value.toLowerCase()}` : value.toLowerCase();
        spinsLeft = data.spins;
        updateSpinsDisplay();
        input.value = '';
        showResultModal(`${data.message} (${data.spins} spins remaining)`);
    }
}

// 替换抽奖逻辑
async function doSpin() {
    if (spinsLeft <= 0) {
        alert('No spins left! Share or come back tomorrow.');
        return;
    }
    
    // 启动动画...
    startSlotAnimation();
    
    // 等动画结束（5秒）
    setTimeout(async () => {
        const res = await fetch('https://memebuddy-api.xxx.workers.dev/api/spin', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ user: currentUserId })
        });
        
        const data = await res.json();
        
        if (data.success) {
            spinsLeft = data.spins;
            updateSpinsDisplay();
            showResultModal(`${data.label}\n+${data.points} points!\nTotal: ${data.totalPoints}`);
        }
    }, 5000);
}

// 页面加载时检查每日奖励
async function checkDaily() {
    if (!currentUserId) return;
    
    const res = await fetch('https://memebuddy-api.xxx.workers.dev/api/daily', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user: currentUserId })
    });
    
    const data = await res.json();
    
    if (data.success) {
        spinsLeft = data.spins;
        updateSpinsDisplay();
        showResultModal(`${data.message} +${data.bonus} bonus spins!\n🔥 Streak: ${data.streak} days`);
    }
}

// 加载全局统计（显示在首页）
async function loadStats() {
    const res = await fetch('https://memebuddy-api.xxx.workers.dev/api/stats');
    const data = await res.json();
    
    // 更新页面显示
    document.getElementById('total-users').textContent = data.totalUsers.toLocaleString();
    document.getElementById('total-spins').textContent = data.totalSpins.toLocaleString();
    document.getElementById('points-given').textContent = data.pointsDistributed.toLocaleString();
}
```

## 第五步：绑定自定义域名（可选）

1. Cloudflare → Workers → memebuddy-api → **Settings** → **Domains & Routes**
2. **Add** → **Custom Domain**
3. 输入 `api.memebuddy.xxx`（你的域名）
4. 等 DNS 生效（几分钟）

然后前端代码用 `https://api.memebuddy.xxx/api/submit` 替换 Worker URL。

---

## API 端点总结

| 端点 | 方法 | 功能 | 参数 |
|------|------|------|------|
| `/api/submit` | POST | 提交钱包/邮箱 | `{type, value, spins}` |
| `/api/spins` | GET | 查询用户状态 | `?user=xxx` |
| `/api/spin` | POST | 消耗一次抽奖 | `{user}` |
| `/api/daily` | POST | 每日登录奖励 | `{user}` |
| `/api/stats` | GET | 全局统计 | 无 |

## 抽奖概率

| 结果 | 概率 | 积分 |
|------|------|------|
| 🦞🦞🦞 JACKPOT | 0.1% | 1000 |
| 💎💎💎 BIG WIN | 2% | 500 |
| 🎰🎰🎰 MEDIUM | 8% | 200 |
| ⭐⭐⭐ NICE | 25% | 50 |
| 🔥 GOOD | 35% | 15 |
| 🎁 PARTICIPATED | 29.9% | 5 |

## 特殊时间奖励

| 时间 | 额外次数 |
|------|---------|
| 每天 | +1 |
| 周一 | +3 |
| 周末 | +2 |
| 连续7天 | +20 |
| 连续30天 | +100 |

---

**全部免费。Cloudflare Workers 每天免费 10 万次请求，KV 免费 10 万次读/天。对于初期完全够用。** 🦞
