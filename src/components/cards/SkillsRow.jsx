import React from 'react';
import Icon from '../Icon.jsx';

export default function SkillsRow({ routed = [], loaded = [] }) {
  const all = Array.from(new Set([...(routed || []), ...(loaded || [])]));
  if (!all.length) return null;
  return (
    <div className="skills-row" title="本轮装载的技能包">
      <Icon name="skill" size={11} className="skills-ico" />
      {all.map((s) => (
        <span key={s} className="skill-chip">{s}</span>
      ))}
    </div>
  );
}
