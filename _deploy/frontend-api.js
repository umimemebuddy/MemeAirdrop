// ============================================
// MEMEBUDDY 前端 API 接入代码
// 将此代码替换到 index.html 的 <script> 部分
// ============================================

// 配置：替换为你的 Worker URL
const API_URL = 'https://memebuddy-api.xxx.workers.dev'; // ← 改成你的

// 全局状态
let currentUserId = null;
let spinsLeft = 0;
let totalPoints = 0;

// ============================================
// 核心函数
// ============================================

// 提交钱包/邮箱
async function handleSubmit() {
    const input = document.getElementById('wallet-input');
    const value = input.value.trim();
    
    if (!value) {
        alert('Please enter a wallet address or email');
        return;
    }
    
    // 简单验证
    const isEmail = value.includes('@');
    const isWallet = value.startsWith('0x') && value.length === 42;
    
    if (!isEmail && !isWallet) {
        alert('Please enter a valid wallet (0x...) or email');
        return;
    }
    
    // 显示加载
    const btn = document.querySelector('.submit-btn');
    const originalText = btn.textContent;
    btn.textContent = 'Submitting...';
    btn.disabled = true;
    
    try {
        const res = await fetch(`${API_URL}/api/submit`, {
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
            // 保存用户ID
            currentUserId = isEmail ? `email:${value.toLowerCase()}` : value.toLowerCase();
            localStorage.setItem('memebuddy_user', currentUserId);
            
            spinsLeft = data.spins;
            updateSpinsDisplay();
            input.value = '';
            
            // 显示成功
            showNotification(data.message, 'success');
            
            // 检查每日奖励
            setTimeout(() => checkDaily(), 1000);
        } else {
            alert(data.error || 'Submission failed');
        }
    } catch (e) {
        alert('Network error. Please try again.');
        console.error(e);
    } finally {
        btn.textContent = originalText;
        btn.disabled = false;
    }
}

// 抽奖
async function doSpin() {
    if (!currentUserId) {
        alert('Please submit wallet or email first!');
        return;
    }
    
    if (spinsLeft <= 0) {
        alert('No spins left! Share on social or come back tomorrow.');
        return;
    }
    
    // 启动老虎机动画
    startSlotAnimation();
    
    // 5秒后调用API
    setTimeout(async () => {
        try {
            const res = await fetch(`${API_URL}/api/spin`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ user: currentUserId })
            });
            
            const data = await res.json();
            
            if (data.success) {
                spinsLeft = data.spins;
                totalPoints = data.totalPoints;
                updateSpinsDisplay();
                
                // 显示结果弹窗
                showResultModal({
                    label: data.label,
                    points: data.points,
                    totalPoints: data.totalPoints
                });
            } else {
                alert(data.error || 'Spin failed');
                stopSlotAnimation();
            }
        } catch (e) {
            alert('Network error');
            stopSlotAnimation();
            console.error(e);
        }
    }, 5000);
}

// 每日登录奖励
async function checkDaily() {
    if (!currentUserId) return;
    
    try {
        const res = await fetch(`${API_URL}/api/daily`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ user: currentUserId })
        });
        
        const data = await res.json();
        
        if (data.success) {
            spinsLeft = data.spins;
            updateSpinsDisplay();
            
            // 显示每日奖励提示
            showNotification(`${data.message} 🔥 Streak: ${data.streak} days`, 'bonus');
        }
    } catch (e) {
        console.error('Daily check failed:', e);
    }
}

// 加载用户状态
async function loadUserState() {
    const savedUser = localStorage.getItem('memebuddy_user');
    if (!savedUser) return;
    
    currentUserId = savedUser;
    
    try {
        const res = await fetch(`${API_URL}/api/spins?user=${encodeURIComponent(currentUserId)}`);
        const data = await res.json();
        
        spinsLeft = data.spins;
        totalPoints = data.totalPoints || 0;
        updateSpinsDisplay();
        
        // 检查每日奖励
        checkDaily();
    } catch (e) {
        console.error('Load state failed:', e);
    }
}

// 加载全局统计
async function loadStats() {
    try {
        const res = await fetch(`${API_URL}/api/stats`);
        const data = await res.json();
        
        // 更新页面显示（需要你的HTML有这些元素）
        const el = document.getElementById('stats-users');
        if (el) el.textContent = data.totalUsers.toLocaleString();
        
        const el2 = document.getElementById('stats-spins');
        if (el2) el2.textContent = data.totalSpins.toLocaleString();
        
        const el3 = document.getElementById('stats-points');
        if (el3) el3.textContent = data.pointsDistributed.toLocaleString();
    } catch (e) {
        console.error('Load stats failed:', e);
    }
}

// ============================================
// UI 辅助函数
// ============================================

function updateSpinsDisplay() {
    const el = document.getElementById('spins-count');
    if (el) el.textContent = spinsLeft;
    
    // 更新按钮状态
    const spinBtn = document.querySelector('.spin-btn');
    if (spinBtn) {
        spinBtn.disabled = spinsLeft <= 0;
        spinBtn.style.opacity = spinsLeft <= 0 ? '0.5' : '1';
    }
}

function showNotification(message, type = 'info') {
    // 简单的顶部通知
    const div = document.createElement('div');
    div.className = `notification notification-${type}`;
    div.textContent = message;
    div.style.cssText = `
        position: fixed; top: 20px; left: 50%; transform: translateX(-50%);
        background: ${type === 'success' ? '#00ff88' : type === 'bonus' ? '#ffd700' : '#00ffff'};
        color: #000; padding: 12px 24px; border-radius: 8px;
        font-family: 'Press Start 2P', monospace; font-size: 12px;
        z-index: 9999; animation: slideDown 0.3s ease;
    `;
    document.body.appendChild(div);
    
    setTimeout(() => div.remove(), 3000);
}

function showResultModal({ label, points, totalPoints }) {
    // 使用你现有的 modal 逻辑
    const modal = document.getElementById('result-modal');
    const labelEl = document.getElementById('result-label');
    const pointsEl = document.getElementById('result-points');
    const totalEl = document.getElementById('result-total');
    
    if (labelEl) labelEl.textContent = label;
    if (pointsEl) pointsEl.textContent = `+${points}`;
    if (totalEl) totalEl.textContent = `Total: ${totalPoints}`;
    if (modal) modal.style.display = 'flex';
}

// ============================================
// 页面初始化
// ============================================

document.addEventListener('DOMContentLoaded', () => {
    // 加载保存的用户
    loadUserState();
    
    // 加载统计
    loadStats();
    
    // 绑定事件
    const submitBtn = document.querySelector('.submit-btn');
    if (submitBtn) submitBtn.addEventListener('click', handleSubmit);
    
    const spinBtn = document.querySelector('.spin-btn');
    if (spinBtn) spinBtn.addEventListener('click', doSpin);
    
    // 回车提交
    const input = document.getElementById('wallet-input');
    if (input) {
        input.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') handleSubmit();
        });
    }
});

// ============================================
// Twitter / Telegram 验证（占位）
// ============================================

async function verifyTwitter() {
    // 方案1: 跳转到 Twitter OAuth
    // window.location.href = `${API_URL}/api/verify/twitter?user=${currentUserId}`;
    
    // 方案2: 简单提示用户手动关注
    window.open('https://twitter.com/DommeByte', '_blank');
    showNotification('Follow @DommeByte then click "I Followed" below!', 'info');
    
    // TODO: 实现验证逻辑
}

async function verifyTelegram() {
    window.open('https://t.me/memebuddy', '_blank');
    showNotification('Join our TG channel then click "I Joined" below!', 'info');
    
    // TODO: 实现验证逻辑
}