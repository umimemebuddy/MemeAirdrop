// Memebuddy Airdrop API - Cloudflare Worker
// Zero-cost backend: Cloudflare Workers + KV

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;

    // CORS headers
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    };

    if (method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    try {
      // Route: POST /api/submit - 提交钱包/邮箱
      if (path === '/api/submit' && method === 'POST') {
        const body = await request.json();
        const { type, value, spins = 1 } = body; // type: 'wallet' or 'email'

        if (!value) {
          return new Response(JSON.stringify({ error: 'Value required' }), {
            status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }

        // 验证格式
        if (type === 'wallet' && !value.startsWith('0x')) {
          return new Response(JSON.stringify({ error: 'Invalid wallet address' }), {
            status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }
        if (type === 'email' && !value.includes('@')) {
          return new Response(JSON.stringify({ error: 'Invalid email' }), {
            status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }

        // 生成用户ID
        const userId = type === 'wallet' ? value.toLowerCase() : `email:${value.toLowerCase()}`;
        const timestamp = Date.now();

        // 存储到 KV
        const key = `user:${userId}`;
        const existing = await env.MEME_KV.get(key);
        let userData = existing ? JSON.parse(existing) : { spins: 0, totalSpins: 0, history: [] };

        // 检查是否重复提交（每个钱包/邮箱只能提交一次）
        if (existing) {
          // 已存在，返回错误
          return new Response(JSON.stringify({ 
            error: 'Already submitted!', 
            message: 'This wallet/email has already been registered.',
            spins: userData.spins,
            isNew: false
          }), { 
            status: 400, 
            headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
          });
        }
        
        // 新用户，增加抽奖次数
        const isNew = true;
        userData.spins = spins;
        userData.totalSpins = spins;
        userData.lastSubmit = timestamp;
        userData.type = type;
        userData.history.push({ action: 'submit', spins, timestamp });

        await env.MEME_KV.put(key, JSON.stringify(userData));

        // 记录到统计
        const statsKey = 'stats:submissions';
        const statsData = await env.MEME_KV.get(statsKey);
        let stats = statsData ? JSON.parse(statsData) : { total: 0, wallets: 0, emails: 0 };
        stats.total++;
        if (type === 'wallet') stats.wallets++;
        else stats.emails++;
        await env.MEME_KV.put(statsKey, JSON.stringify(stats));

        return new Response(JSON.stringify({
          success: true,
          isNew,
          spins: userData.spins,
          message: isNew ? `Welcome! +${spins} spins` : `+${spins} more spins!`
        }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }

      // Route: GET /api/spins - 获取用户信息
      if (path === '/api/spins' && method === 'GET') {
        const userId = url.searchParams.get('user');
        
        if (!userId) {
          return new Response(JSON.stringify({ error: 'User ID required' }), {
            status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }

        const key = `user:${userId.toLowerCase()}`;
        const data = await env.MEME_KV.get(key);

        if (!data) {
          return new Response(JSON.stringify({ spins: 0, totalSpins: 0 }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }

        const userData = JSON.parse(data);
        return new Response(JSON.stringify({
          spins: userData.spins,
          totalSpins: userData.totalSpins,
          lastSubmit: userData.lastSubmit,
          lastDaily: userData.lastDaily
        }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }

      // Route: POST /api/spin - 消耗一次抽奖
      if (path === '/api/spin' && method === 'POST') {
        const body = await request.json();
        const { user, result = 'small' } = body;

        if (!user) {
          return new Response(JSON.stringify({ error: 'User required' }), {
            status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }

        const key = `user:${user.toLowerCase()}`;
        const data = await env.MEME_KV.get(key);

        if (!data) {
          return new Response(JSON.stringify({ error: 'User not found' }), {
            status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }

        const userData = JSON.parse(data);

        if (userData.spins <= 0) {
          return new Response(JSON.stringify({ error: 'No spins left', spins: 0 }), {
            status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }

        // 抽奖逻辑（100%中奖）
        const prizes = {
          'jackpot': { chance: 0.001, points: 1000, label: '🦞🦞🦞 JACKPOT!' },
          'big': { chance: 0.02, points: 500, label: '💎💎💎 BIG WIN!' },
          'medium': { chance: 0.08, points: 200, label: '🎰🎰🎰 MEDIUM!' },
          'small': { chance: 0.25, points: 50, label: '⭐⭐⭐ NICE!' },
          'tiny': { chance: 0.35, points: 15, label: '🔥 GOOD!' },
          'micro': { chance: 0.299, points: 5, label: '🎁 PARTICIPATED' }
        };

        // 随机结果
        const rand = Math.random();
        let cumulative = 0;
        let prize = prizes.micro;
        
        for (const [key, p] of Object.entries(prizes)) {
          cumulative += p.chance;
          if (rand <= cumulative) {
            prize = p;
            break;
          }
        }

        // 扣除次数，增加积分
        userData.spins -= 1;
        userData.totalPoints = (userData.totalPoints || 0) + prize.points;
        userData.history.push({ action: 'spin', prize: prize.label, points: prize.points, timestamp: Date.now() });

        await env.MEME_KV.put(key, JSON.stringify(userData));

        // 更新统计
        const statsKey = 'stats:spins';
        const statsData = await env.MEME_KV.get(statsKey);
        let stats = statsData ? JSON.parse(statsData) : { total: 0, today: 0, points: 0 };
        stats.total++;
        stats.today++;
        stats.points += prize.points;
        await env.MEME_KV.put(statsKey, JSON.stringify(stats));

        return new Response(JSON.stringify({
          success: true,
          spins: userData.spins,
          points: prize.points,
          totalPoints: userData.totalPoints,
          label: prize.label
        }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }

      // Route: POST /api/daily - 每日登录奖励
      if (path === '/api/daily' && method === 'POST') {
        const body = await request.json();
        const { user } = body;

        if (!user) {
          return new Response(JSON.stringify({ error: 'User required' }), {
            status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }

        const key = `user:${user.toLowerCase()}`;
        const data = await env.MEME_KV.get(key);

        if (!data) {
          return new Response(JSON.stringify({ error: 'User not found. Submit wallet/email first!' }), {
            status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }

        const userData = JSON.parse(data);
        const now = Date.now();
        const DAY_MS = 24 * 60 * 60 * 1000;

        // 检查是否已领取
        if (userData.lastDaily && (now - userData.lastDaily) < DAY_MS) {
          const nextDaily = userData.lastDaily + DAY_MS - now;
          const hours = Math.floor(nextDaily / (60 * 60 * 1000));
          return new Response(JSON.stringify({ 
            error: 'Daily already claimed!', 
            nextClaimIn: hours + ' hours',
            spins: userData.spins
          }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
        }

        // 检查特殊日期奖励
        const date = new Date(now);
        const dayOfWeek = date.getDay(); // 0=周日
        const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
        const isMonday = dayOfWeek === 1;
        
        let bonus = 1;
        let bonusType = 'daily';

        if (isMonday) { bonus = 3; bonusType = 'monday'; }
        else if (isWeekend) { bonus = 2; bonusType = 'weekend'; }

        // 连续登录奖励
        const streak = userData.lastDaily ? ((now - userData.lastDaily) < (2 * DAY_MS) ? (userData.streak || 0) + 1 : 1) : 1;
        
        if (streak >= 7) bonus += 20;
        else if (streak >= 30) bonus += 100;

        userData.spins += bonus;
        userData.streak = streak;
        userData.lastDaily = now;
        userData.history.push({ action: 'daily', bonus, bonusType, streak, timestamp: now });

        await env.MEME_KV.put(key, JSON.stringify(userData));

        return new Response(JSON.stringify({
          success: true,
          spins: userData.spins,
          bonus,
          bonusType,
          streak,
          message: bonusType === 'monday' ? 'Monday Bonus! +3' : 
                   bonusType === 'weekend' ? 'Weekend Bonus! +2' : 
                   'Daily! +1'
        }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }

      // Route: GET /api/stats - 全局统计
      if (path === '/api/stats' && method === 'GET') {
        const submissions = await env.MEME_KV.get('stats:submissions');
        const spins = await env.MEME_KV.get('stats:spins');

        const subData = submissions ? JSON.parse(submissions) : { total: 0, wallets: 0, emails: 0 };
        const spinData = spins ? JSON.parse(spins) : { total: 0, today: 0, points: 0 };

        return new Response(JSON.stringify({
          totalUsers: subData.total,
          totalWallets: subData.wallets,
          totalEmails: subData.emails,
          totalSpins: spinData.total,
          spinsToday: spinData.today,
          pointsDistributed: spinData.points
        }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }


      // Route: GET /api/history - Get user activity history
      if (path === '/api/history' && method === 'GET') {
        const userId = url.searchParams.get('user');
        
        if (!userId) {
          return new Response(JSON.stringify({ error: 'User ID required' }), {
            status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }

        const key = `user:${userId.toLowerCase()}`;
        const data = await env.MEME_KV.get(key);

        if (!data) {
          return new Response(JSON.stringify({ history: [] }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }

        const userData = JSON.parse(data);
        const history = (userData.history || []).reverse().slice(0, 20);

        return new Response(JSON.stringify({
          history,
          totalPoints: userData.totalPoints || 0,
          totalSpins: userData.totalSpins || 0,
          spins: userData.spins || 0,
          streak: userData.streak || 0,
          type: userData.type || 'wallet'
        }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }

      // Route: POST /api/logout - Clear daily claim for next login
      if (path === '/api/logout' && method === 'POST') {
        return new Response(JSON.stringify({ success: true }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }

      // 404
      return new Response(JSON.stringify({ error: 'Not found' }), {
        status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });

    } catch (e) {
      return new Response(JSON.stringify({ error: e.message }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }
  }
};
