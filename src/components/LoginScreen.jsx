import React, { useState } from 'react';

export default function LoginScreen({ setupRequired, onAuthenticated }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const title = setupRequired ? '初始化管理员账号' : '登录墨枢';
  const action = setupRequired ? '创建账号并进入' : '登录';

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    if (setupRequired && password !== confirm) {
      setError('两次输入的密码不一致');
      return;
    }
    setBusy(true);
    try {
      const r = await fetch(setupRequired ? '/api/auth/setup' : '/api/auth/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ username, password }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || '认证失败');
      onAuthenticated?.(d.user);
    } catch (err) {
      setError(String(err.message || err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="auth-shell">
      <form className="auth-panel" onSubmit={submit}>
        <div className="auth-brand">
          <span className="brand-seal" aria-hidden="true">墨</span>
          <div>
            <h1>{title}</h1>
            <p>{setupRequired ? '第一次部署需要创建一个管理员账号。之后系统会关闭公开注册。' : '输入你的账号进入个人写作空间。'}</p>
          </div>
        </div>

        <label className="auth-field">
          <span>用户名</span>
          <input
            autoFocus
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="3-32 位英文、数字、_ 或 -"
            autoComplete="username"
          />
        </label>

        <label className="auth-field">
          <span>密码</span>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="至少 8 位"
            autoComplete={setupRequired ? 'new-password' : 'current-password'}
          />
        </label>

        {setupRequired && (
          <label className="auth-field">
            <span>确认密码</span>
            <input
              type="password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              placeholder="再输入一次密码"
              autoComplete="new-password"
            />
          </label>
        )}

        {error && <div className="auth-error">{error}</div>}

        <button className="auth-submit" type="submit" disabled={busy || !username.trim() || !password}>
          {busy ? '处理中...' : action}
        </button>
      </form>
    </main>
  );
}
