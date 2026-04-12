/**
 * AdaptationIndicator.tsx
 * RÔLE : Indicateur discret que l'adaptation est active.
 * Affiche un petit badge vert quand le moteur adapte le texte.
 */

import React from 'react';

interface AdaptationIndicatorProps {
  isActive: boolean;
}

export const AdaptationIndicator: React.FC<AdaptationIndicatorProps> = ({ isActive }) => {
  if (!isActive) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        display:      'inline-flex',
        alignItems:   'center',
        gap:          6,
        padding:      '4px 10px',
        background:   '#E1F5EE',
        borderRadius: 99,
        fontSize:     '0.75rem',
        color:        '#085041',
        fontWeight:   500,
        marginBottom: '0.75rem',
      }}
    >
      <span style={{
        width:        7,
        height:       7,
        borderRadius: '50%',
        background:   '#1D9E75',
        display:      'inline-block',
      }} />
      Adaptation active
    </div>
  );
};