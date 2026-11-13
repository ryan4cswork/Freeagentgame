import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { isConfigured, supabase } from './supabase';

const TEAM_PLACEHOLDER = 'Choose an MLB team';

function ErrorLine({ children }) {
  return children ? <div className="notice error">{children}</div> : null;
}
function SuccessLine({ children }) {
  return children ? <div className="notice success">{children}</div> : null;
}
function pointsFor(rank) {
  return rank <= 15 ? 50 : rank <= 35 ? 35 : 25;
}

export default function App() {
  const [session, setSession] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [authMode, setAuthMode] = useState('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [authMessage, setAuthMessage] = useState('');
  const [error, setError] = useState('');
  const [leagues, setLeagues] = useState([]);
  const [leagueId, setLeagueId] = useState('');
  const [joinCode, setJoinCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [game, setGame] = useState(null);
  const [players, setPlayers] = useState([]);
  const [teams, setTeams] = useState([]);
  const [members, setMembers] = useState([]);
  const [progress, setProgress] = useState({});
  const [signings, setSignings] = useState({});
  const [myPick, setMyPick] = useState(null);
  const [leaderboard, setLeaderboard] = useState([]);
  const [pickTeam, setPickTeam] = useState('');
  const [actualTeam, setActualTeam] = useState('');
  const [correctionUser, setCorrectionUser] = useState('');
  const [correctionTeam, setCorrectionTeam] = useState('');
  const [tab, setTab] = useState('game');
  const [copied, setCopied] = useState(false);
  const lastLoadedRank = useRef(null);

  useEffect(() => {
    if (!isConfigured) { setAuthLoading(false); return; }
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setAuthLoading(false);
    });
    const { data: listener } = supabase.auth.onAuthStateChange((_event, next) => setSession(next));
    return () => listener.subscription.unsubscribe();
  }, []);

  const loadLeagues = useCallback(async () => {
    if (!session?.user?.id) return;
    const { data: memberships, error: memberError } = await supabase
      .from('league_members').select('league_id').eq('user_id', session.user.id);
    if (memberError) throw memberError;
    if (!memberships?.length) { setLeagues([]); setLeagueId(''); return; }
    const ids = memberships.map((m) => m.league_id);
    const { data, error: leagueError } = await supabase.from('leagues')
      .select('id,name,invite_code,commissioner_id').in('id', ids).order('created_at');
    if (leagueError) throw leagueError;
    setLeagues(data || []);
    setLeagueId((current) => ids.includes(current) ? current : (data?.[0]?.id || ''));
  }, [session?.user?.id]);

  useEffect(() => {
    if (session) loadLeagues().catch((e) => setError(e.message));
    else { setLeagues([]); setLeagueId(''); }
  }, [session, loadLeagues]);

  const loadGame = useCallback(async () => {
    if (!leagueId || !session?.user?.id) return;
    const [leagueRes, stateRes, playerRes, teamRes, memberRes, progressRes, signingRes, pickRes] = await Promise.all([
      supabase.from('leagues').select('id,name,invite_code,commissioner_id').eq('id', leagueId).single(),
      supabase.from('game_state').select('*').eq('league_id', leagueId).single(),
      supabase.from('players').select('*').order('rank'),
      supabase.from('mlb_teams').select('team_name').order('team_name'),
      supabase.from('league_members').select('user_id,role,joined_at').eq('league_id', leagueId).order('joined_at'),
      supabase.from('player_progress').select('player_rank,submitted_count').eq('league_id', leagueId),
      supabase.from('signings').select('player_rank,actual_team').eq('league_id', leagueId),
      supabase.from('predictions').select('player_rank,predicted_team').eq('league_id', leagueId).eq('user_id', session.user.id)
    ]);
    for (const r of [leagueRes,stateRes,playerRes,teamRes,memberRes,progressRes,signingRes,pickRes]) if (r.error) throw r.error;
    const memberIds = (memberRes.data || []).map((m) => m.user_id);
    let profiles = [];
    if (memberIds.length) {
      const profileRes = await supabase.from('profiles').select('user_id,display_name').in('user_id', memberIds);
      if (profileRes.error) throw profileRes.error;
      profiles = profileRes.data || [];
    }
    const profileMap = Object.fromEntries(profiles.map((p) => [p.user_id, p.display_name]));
    setGame({ ...leagueRes.data, ...stateRes.data });
    setPlayers(playerRes.data || []);
    setTeams((teamRes.data || []).map((t) => t.team_name));
    setMembers((memberRes.data || []).map((m) => ({ ...m, display_name: profileMap[m.user_id] || 'Player' })));
    setProgress(Object.fromEntries((progressRes.data || []).map((p) => [p.player_rank, p.submitted_count])));
    setSignings(Object.fromEntries((signingRes.data || []).map((s) => [s.player_rank, s.actual_team])));
    const currentPick = (pickRes.data || []).find((p) => p.player_rank === stateRes.data.current_player_rank) || null;
    setMyPick(currentPick);
    const currentActual = (signingRes.data || []).find((s) => s.player_rank === stateRes.data.current_player_rank)?.actual_team || '';
    const rankKey = `${leagueId}:${stateRes.data.current_player_rank}`;
    if (lastLoadedRank.current !== rankKey) {
      setPickTeam(currentPick?.predicted_team || '');
      setActualTeam(currentActual);
      lastLoadedRank.current = rankKey;
    }
    setDisplayName(profileMap[session.user.id] || '');
    if (stateRes.data.revealed) {
      const scoreRes = await supabase.from('leaderboard').select('*').eq('league_id', leagueId)
        .order('total_points', { ascending: false }).order('correct_predictions', { ascending: false });
      if (scoreRes.error) throw scoreRes.error;
      setLeaderboard(scoreRes.data || []);
    } else setLeaderboard([]);
  }, [leagueId, session?.user?.id]);

  useEffect(() => {
    if (!leagueId || !session) return;
    loadGame().catch((e) => setError(e.message));
    const channel = supabase.channel(`league-${leagueId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'game_state', filter: `league_id=eq.${leagueId}` }, () => loadGame().catch((e) => setError(e.message)))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'player_progress', filter: `league_id=eq.${leagueId}` }, () => loadGame().catch((e) => setError(e.message)))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'signings', filter: `league_id=eq.${leagueId}` }, () => loadGame().catch((e) => setError(e.message)))
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [leagueId, session, loadGame]);

  const currentPlayer = useMemo(() => players.find((p) => p.rank === game?.current_player_rank), [players, game]);
  const currentProgress = progress[game?.current_player_rank] || 0;
  const isCommissioner = game?.commissioner_id === session?.user?.id;
  const myMember = members.find((m) => m.user_id === session?.user?.id);
  const currentSigning = signings[game?.current_player_rank] || '';

  async function runAction(action) {
    setBusy(true); setError(''); setAuthMessage('');
    try { await action(); }
    catch (e) { setError(e.message || 'Something went wrong.'); }
    finally { setBusy(false); }
  }

  async function handleAuth(e) {
    e.preventDefault();
    await runAction(async () => {
      if (authMode === 'signup') {
        const { data, error: e1 } = await supabase.auth.signUp({ email, password, options: { data: { display_name: displayName } } });
        if (e1) throw e1;
        if (!data.session) setAuthMessage('Check your email for the confirmation link, then sign in here.');
        else setAuthMessage('Account created. You can now create or join the game.');
      } else {
        const { error: e1 } = await supabase.auth.signInWithPassword({ email, password });
        if (e1) throw e1;
      }
    });
  }

  async function createLeague() {
    await runAction(async () => {
      const { data, error: e1 } = await supabase.rpc('create_free_agent_league', { p_display_name: displayName || email.split('@')[0] });
      if (e1) throw e1;
      await loadLeagues();
      setLeagueId(data.league_id);
      setAuthMessage(`Your invite code is ${data.invite_code}. Share it with the group.`);
    });
  }

  async function joinLeague(e) {
    e.preventDefault();
    await runAction(async () => {
      const { data, error: e1 } = await supabase.rpc('join_free_agent_league', {
        p_invite_code: joinCode.trim(), p_display_name: displayName || email.split('@')[0]
      });
      if (e1) throw e1;
      await loadLeagues();
      setLeagueId(data);
      setJoinCode('');
    });
  }

  async function submitPick() {
    if (!currentPlayer || !pickTeam) return;
    await runAction(async () => {
      const { error: e1 } = await supabase.from('predictions').upsert({
        league_id: leagueId, player_rank: currentPlayer.rank, user_id: session.user.id,
        predicted_team: pickTeam, updated_at: new Date().toISOString()
      }, { onConflict: 'league_id,player_rank,user_id' });
      if (e1) throw e1;
      await loadGame();
      setAuthMessage('Your pick is saved privately.');
    });
  }

  async function setStatus(status) {
    await runAction(async () => {
      const { error: e1 } = await supabase.rpc('set_game_status', { p_league_id: leagueId, p_status: status });
      if (e1) throw e1;
      await loadGame();
    });
  }

  async function advancePlayer() {
    await runAction(async () => {
      const { error: e1 } = await supabase.rpc('advance_free_agent_player', { p_league_id: leagueId });
      if (e1) throw e1;
      await loadGame();
    });
  }

  async function saveSigning(rank, team) {
    if (!team) return;
    await runAction(async () => {
      const { error: e1 } = await supabase.from('signings').upsert({
        league_id: leagueId, player_rank: rank,
        actual_team: team, entered_by: session.user.id
      }, { onConflict: 'league_id,player_rank' });
      if (e1) throw e1;
      await loadGame();
      setAuthMessage('Actual signing saved.');
    });
  }

  async function enterSigning() {
    if (!currentPlayer || !actualTeam) return;
    await saveSigning(currentPlayer.rank, actualTeam);
  }

  async function correctPick() {
    if (!correctionUser || !correctionTeam || !currentPlayer) return;
    await runAction(async () => {
      const { error: e1 } = await supabase.rpc('commissioner_correct_prediction', {
        p_league_id: leagueId, p_user_id: correctionUser,
        p_player_rank: currentPlayer.rank, p_predicted_team: correctionTeam
      });
      if (e1) throw e1;
      setAuthMessage('Participant entry corrected.');
      setCorrectionTeam('');
    });
  }

  async function revealPicks() {
    await runAction(async () => {
      const { error: e1 } = await supabase.rpc('reveal_free_agent_picks', { p_league_id: leagueId });
      if (e1) throw e1;
      await loadGame();
    });
  }

  async function copyInvite() {
    await navigator.clipboard.writeText(game.invite_code);
    setCopied(true); setTimeout(() => setCopied(false), 1600);
  }

  async function signOut() { await supabase.auth.signOut(); setGame(null); }

  if (!isConfigured) return <main className="center-screen"><section className="auth-card"><div className="brand-mark">FA</div><p className="eyebrow">MLB OFFSEASON PREDICTIONS</p><h1>Free Agent Game</h1><ErrorLine>Supabase settings are missing. Add the project URL and publishable key to your .env file.</ErrorLine></section></main>;
  if (authLoading) return <main className="center-screen"><div className="loader" /></main>;

  if (!session) return <main className="center-screen"><section className="auth-card">
    <div className="brand-mark">FA</div><p className="eyebrow">MLB OFFSEASON PREDICTIONS</p><h1>Free Agent Game</h1>
    <p className="muted">Make your picks. Track every signing. See who called it best.</p>
    <div className="switcher"><button className={authMode==='signin'?'active':''} onClick={()=>{setAuthMode('signin');setError('');}}>Sign in</button><button className={authMode==='signup'?'active':''} onClick={()=>{setAuthMode('signup');setError('');}}>Create account</button></div>
    <form onSubmit={handleAuth} className="stack">
      {authMode==='signup' && <label>Display name<input value={displayName} onChange={e=>setDisplayName(e.target.value)} placeholder="Your name" maxLength={40} required /></label>}
      <label>Email<input type="email" value={email} onChange={e=>setEmail(e.target.value)} placeholder="you@example.com" required /></label>
      <label>Password<input type="password" value={password} onChange={e=>setPassword(e.target.value)} minLength={8} placeholder="At least 8 characters" required /></label>
      <button className="primary full" disabled={busy}>{busy?'Please wait…':authMode==='signin'?'Sign in':'Create account'}</button>
    </form>
    <ErrorLine>{error}</ErrorLine><SuccessLine>{authMessage}</SuccessLine>
    <p className="tiny muted">Use the same account on your phone and any other device.</p>
  </section></main>;

  if (!leagues.length) return <main className="center-screen"><section className="auth-card wide">
    <div className="brand-mark">FA</div><p className="eyebrow">WELCOME TO THE LEAGUE</p><h1>Free Agent Game</h1>
    <p className="muted">Start a new game as commissioner, or join your group with an invite code.</p>
    <label>Your display name<input value={displayName} onChange={e=>setDisplayName(e.target.value)} placeholder="Name shown to the group" maxLength={40} /></label>
    <button className="primary full" disabled={busy} onClick={createLeague}>Create a new game</button>
    <div className="or-line"><span>OR JOIN A GAME</span></div>
    <form onSubmit={joinLeague} className="stack"><label>Invite code<input value={joinCode} onChange={e=>setJoinCode(e.target.value.toUpperCase())} placeholder="12-character code" maxLength={12} required /></label><button className="secondary full" disabled={busy}>Join game</button></form>
    <ErrorLine>{error}</ErrorLine><SuccessLine>{authMessage}</SuccessLine>
    <button className="link-button" onClick={signOut}>Sign out</button>
  </section></main>;

  return <div className="app-shell">
    <header className="topbar"><div className="brand"><div className="brand-mark small">FA</div><div><strong>Free Agent Game</strong><span>2026–27 MLB offseason</span></div></div><div className="top-actions">
      {leagues.length>1 && <select className="league-select" value={leagueId} onChange={e=>setLeagueId(e.target.value)}>{leagues.map(l=><option key={l.id} value={l.id}>{l.name}</option>)}</select>}
      <span className="user-chip">{displayName || session.user.email}</span><button className="quiet-button" onClick={signOut}>Sign out</button>
    </div></header>
    <main className="main-content">
      <div className="page-heading"><div><p className="eyebrow">THE OFFSEASON PICK'EM</p><h1>Game Night</h1><p className="muted">One player at a time. Everyone picks privately. Reveal together at the end.</p></div><div className="invite-box"><span>INVITE CODE</span><strong>{game?.invite_code}</strong><button onClick={copyInvite}>{copied?'Copied!':'Copy code'}</button></div></div>
      <nav className="tabs"><button className={tab==='game'?'selected':''} onClick={()=>setTab('game')}>Game night</button><button className={tab==='players'?'selected':''} onClick={()=>setTab('players')}>All 50 players</button>{isCommissioner && <button className={tab==='signings'?'selected':''} onClick={()=>setTab('signings')}>Actual signings</button>}{game?.revealed && <button className={tab==='leaderboard'?'selected':''} onClick={()=>setTab('leaderboard')}>Leaderboard</button>}</nav>
      <ErrorLine>{error}</ErrorLine><SuccessLine>{authMessage}</SuccessLine>
      {tab==='game' && <>
        <section className="status-strip"><div><span className="status-dot" data-status={game?.status}></span><strong>{game?.status?.toUpperCase()}</strong><span className="muted">{game?.revealed?'Picks revealed':game?.status==='completed'?'All players submitted':`Player ${game?.current_player_rank} of 50`}</span></div><div className="progress-track"><span style={{width:`${((game?.current_player_rank || 1)/50)*100}%`}} /></div></section>
        {game?.revealed ? <section className="panel"><div className="panel-head"><div><p className="eyebrow">FINAL RESULTS</p><h2>Leaderboard</h2></div><span className="pill">All picks revealed</span></div><Leaderboard rows={leaderboard}/></section> : <div className="game-grid">
          <section className="panel player-panel"><div className="panel-head"><div><p className="eyebrow">CURRENT FREE AGENT</p><h2>{currentPlayer?.player_name || 'Loading player…'}</h2></div><span className="rank-badge">#{currentPlayer?.rank}</span></div>
            <div className="player-meta"><span>{currentPlayer?.position}</span><span>Previous team: {currentPlayer?.previous_team}</span><span>{pointsFor(currentPlayer?.rank || 50)} points</span></div>
            <div className="pick-area"><div className="pick-top"><div><strong>Your prediction</strong><p className="muted">Your choice is private until the commissioner reveals all picks.</p></div>{myPick && <span className="pill success-pill">Saved</span>}</div>
              <label className="select-label">Where will this player sign?<select value={pickTeam} onChange={e=>setPickTeam(e.target.value)} disabled={game?.status!=='live'}><option value="">{TEAM_PLACEHOLDER}</option>{teams.map(t=><option key={t}>{t}</option>)}</select></label>
              <button className="primary" disabled={busy || game?.status!=='live' || !pickTeam} onClick={submitPick}>{myPick?'Update my pick':'Save my pick'}</button>
              {game?.status==='paused' && <p className="small-note">The commissioner paused the game. Picks are temporarily locked.</p>}
              {game?.status==='setup' && <p className="small-note">Waiting for the commissioner to start game night.</p>}
            </div>
            <div className="progress-summary"><div><strong>{currentProgress} / {members.length}</strong><span>picks submitted</span></div><div className="mini-track"><span style={{width:`${members.length ? currentProgress/members.length*100 : 0}%`}} /></div><span className="muted tiny">Only the submission count is shared — not anyone's team choice.</span></div>
          </section>
          <aside className="panel side-panel"><div className="panel-head"><div><p className="eyebrow">YOUR GROUP</p><h3>{members.length} participants</h3></div></div><ul className="member-list">{members.map(m=><li key={m.user_id}><span className="avatar">{m.display_name.slice(0,1).toUpperCase()}</span><span className="member-name">{m.display_name}{m.user_id===session.user.id?' (you)':''}</span>{m.role==='commissioner'&&<span className="role-tag">Commissioner</span>}</li>)}</ul>
            {isCommissioner && <div className="commissioner-box"><p className="eyebrow">COMMISSIONER CONTROLS</p>
              {game?.status==='setup' && <button className="primary full" disabled={busy} onClick={()=>setStatus('live')}>Start game night</button>}
              {game?.status==='live' && <button className="secondary full" disabled={busy} onClick={()=>setStatus('paused')}>Pause game</button>}
              {game?.status==='paused' && <button className="primary full" disabled={busy} onClick={()=>setStatus('live')}>Resume game</button>}
              {(game?.status==='live' || game?.status==='paused') && <>
                <div className="divider-line"/><label className="select-label">Actual signing destination<select value={actualTeam} onChange={e=>setActualTeam(e.target.value)}><option value="">{TEAM_PLACEHOLDER}</option>{teams.map(t=><option key={t}>{t}</option>)}</select></label><button className="secondary full" disabled={busy || !actualTeam} onClick={enterSigning}>{currentSigning?'Update actual signing':'Save actual signing'}</button>
                <div className="divider-line"/><label className="select-label">Correct a participant's pick<select value={correctionUser} onChange={e=>setCorrectionUser(e.target.value)}><option value="">Choose participant</option>{members.filter(m=>m.user_id!==session.user.id).map(m=><option key={m.user_id} value={m.user_id}>{m.display_name}</option>)}</select></label><label className="select-label"><span className="sr-only">Corrected team</span><select value={correctionTeam} onChange={e=>setCorrectionTeam(e.target.value)}><option value="">Corrected team</option>{teams.map(t=><option key={t}>{t}</option>)}</select></label><button className="secondary full" disabled={busy || !correctionUser || !correctionTeam} onClick={correctPick}>Save correction</button>
                <div className="divider-line"/><button className="primary full" disabled={busy || game?.status!=='live' || currentProgress!==members.length} onClick={advancePlayer}>{game.current_player_rank===50?'Finish game':'Advance to next player'}</button><p className="tiny muted">The next player unlocks only after every participant has submitted.</p>
              </>}
              {game?.status==='completed' && <><p className="small-note">All 50 players are complete. You can reveal everyone's picks at once.</p><button className="primary full" disabled={busy} onClick={revealPicks}>Reveal all predictions</button></>}
            </div>}
            {!isCommissioner && <div className="small-note">The commissioner controls the player order, actual signings, and final reveal.</div>}
          </aside>
        </div>}
      </>}
      {tab==='players' && <section className="panel"><div className="panel-head"><div><p className="eyebrow">THE FULL BOARD</p><h2>Top 50 free agents</h2></div><span className="pill">Max score: 1,825</span></div><div className="table-wrap"><table><thead><tr><th>Rank</th><th>Player</th><th>Position</th><th>Previous team</th><th>Points</th><th>Actual signing</th></tr></thead><tbody>{players.map(p=><tr key={p.rank}><td>#{p.rank}</td><td className="player-name-cell">{p.player_name}</td><td>{p.position}</td><td>{p.previous_team}</td><td>{p.points}</td><td>{signings[p.rank]||'—'}</td></tr>)}</tbody></table></div></section>}
      {tab==='signings' && isCommissioner && <section className="panel"><div className="panel-head"><div><p className="eyebrow">COMMISSIONER TOOLS</p><h2>Actual signings</h2><p className="muted small-note">Enter or update each player's destination as deals become official. Scores refresh after the reveal.</p></div></div><div className="table-wrap"><table><thead><tr><th>Rank</th><th>Player</th><th>Previous team</th><th>Actual destination</th><th></th></tr></thead><tbody>{players.map(p=><tr key={p.rank}><td>#{p.rank}</td><td className="player-name-cell">{p.player_name}</td><td>{p.previous_team}</td><td><select value={signings[p.rank]||''} onChange={e=>setSignings(old=>({...old,[p.rank]:e.target.value}))}><option value="">Not signed / not entered</option>{teams.map(t=><option key={t}>{t}</option>)}</select></td><td><button className="secondary" disabled={busy || !signings[p.rank]} onClick={()=>saveSigning(p.rank,signings[p.rank])}>Save</button></td></tr>)}</tbody></table></div></section>}
      {tab==='leaderboard' && game?.revealed && <section className="panel"><div className="panel-head"><div><p className="eyebrow">FINAL RESULTS</p><h2>Leaderboard</h2></div></div><Leaderboard rows={leaderboard}/></section>}
      <footer className="footer-note">Free Agent Game · Private picks until the commissioner reveals the results.</footer>
    </main>
  </div>;
}

function Leaderboard({ rows }) {
  if (!rows.length) return <p className="muted">No scores to show yet.</p>;
  return <div className="table-wrap"><table><thead><tr><th>Place</th><th>Participant</th><th>Points</th><th>Correct picks</th><th>Scored players</th></tr></thead><tbody>{rows.map((r,i)=><tr key={r.user_id}><td><span className={`place place-${i+1}`}>{i+1}</span></td><td className="player-name-cell">{r.display_name}</td><td className="score-cell">{r.total_points}</td><td>{r.correct_predictions}</td><td>{r.scored_players} / 50</td></tr>)}</tbody></table></div>;
}