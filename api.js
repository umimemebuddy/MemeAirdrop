// Memebuddy Airdrop API - Cloudflare Worker
// Zero-cost backend: Cloudflare Workers + KV
// Updated: 2026-04-03 - Added Sherlock async queue

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;

    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    };

    if (method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    try {
      // ========== SHERLOCK ROUTES ==========
      
      // POST /api/sherlock/search - Submit username search
      if (path === '/api/sherlock/search' && method === 'POST') {
        const body = await request.json();
        const { username } = body;
        
        if (!username || username.length < 1 || username.length > 50) {
          return new Response(JSON.stringify({ error: 'Username required (1-50 chars)' }), {
            status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }
        
        // Generate job ID
        const jobId = crypto.randomUUID();
        const timestamp = Date.now();
        
        // Store job in KV
        const jobKey = `sherlock:job:${jobId}`;
        await env.MEME_KV.put(jobKey, JSON.stringify({
          username: username.toLowerCase(),
          status: 'pending',
          createdAt: timestamp,
          results: []
        }), { expirationTtl: 86400 }); // Expire in 24h
        
        // Add to pending queue
        const queueKey = 'sherlock:queue:pending';
        const queueData = await env.MEME_KV.get(queueKey);
        let queue = queueData ? JSON.parse(queueData) : [];
        queue.push({ jobId, username: username.toLowerCase(), createdAt: timestamp });
        await env.MEME_KV.put(queueKey, JSON.stringify(queue));
        
        return new Response(JSON.stringify({
          success: true,
          jobId,
          message: 'Search submitted. Results in ~1-2 minutes.'
        }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }
      
      // GET /api/sherlock/results/:jobId - Get results
      if (path.startsWith('/api/sherlock/results/') && method === 'GET') {
        const jobId = path.split('/').pop();
        const jobKey = `sherlock:job:${jobId}`;
        const data = await env.MEME_KV.get(jobKey);
        
        if (!data) {
          return new Response(JSON.stringify({ error: 'Job not found or expired' }), {
            status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }
        
        const job = JSON.parse(data);
        return new Response(JSON.stringify({
          status: job.status,
          results: job.results,
          error: job.error,
          completedAt: job.completedAt
        }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }
      
      // GET /api/sherlock/pending - Get pending jobs (for worker)
      if (path === '/api/sherlock/pending' && method === 'GET') {
        const queueKey = 'sherlock:queue:pending';
        const data = await env.MEME_KV.get(queueKey);
        const queue = data ? JSON.parse(data) : [];
        
        return new Response(JSON.stringify({ jobs: queue }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }
      
      // POST /api/sherlock/complete - Submit results (for worker)
      if (path === '/api/sherlock/complete' && method === 'POST') {
        const body = await request.json();
        const { jobId, results, error } = body;
        
        if (!jobId) {
          return new Response(JSON.stringify({ error: 'jobId required' }), {
            status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }
        
        const jobKey = `sherlock:job:${jobId}`;
        const jobData = await env.MEME_KV.get(jobKey);
        
        if (!jobData) {
          return new Response(JSON.stringify({ error: 'Job not found' }), {
            status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }
        
        const job = JSON.parse(jobData);
        job.status = error ? 'error' : 'complete';
        job.results = results || [];
        job.error = error;
        job.completedAt = Date.now();
        
        await env.MEME_KV.put(jobKey, JSON.stringify(job));
        
        // Remove from pending queue
        const queueKey = 'sherlock:queue:pending';
        const queueData = await env.MEME_KV.get(queueKey);
        let queue = queueData ? JSON.parse(queueData) : [];
        queue = queue.filter(j => j.jobId !== jobId);
        await env.MEME_KV.put(queueKey, JSON.stringify(queue));
        
        return new Response(JSON.stringify({ success: true }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }

      // ========== EXISTING ROUTES ==========
      
      // POST /api/submit
      if (path === '/api/submit' && method === 'POST') {
        const body = await request.json();
        const { type, value, spins = 1 } = body;

        if (!value) {
          return new Response(JSON.stringify({ error: 'Value required' }), {
            status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }

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

        const userId = type === 'wallet' ? value.toLowerCase() : `email:${value.toLowerCase()}`;
        const timestamp = Date.now();

        const key = `user:${userId}`;
        const existing = await env.MEME_KV.get(key);
        let userData = existing ? JSON.parse(existing) : { spins: 0, totalSpins: 0, history: [] };

        const isNew = userData.spins === 0 && userData.totalSpins === 0;
        
        userData.spins += spins;
        userData.totalSpins += spins;
        userData.lastSubmit = timestamp;
        userData.type = type;
        userData.history.push({ action: 'submit', spins, timestamp });

        await env.MEME_KV.put(key, JSON.stringify(userData));

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

      // GET /api/spins
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

      // GET /api/stats
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
