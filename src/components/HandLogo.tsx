import React from 'react';

interface HandLogoProps {
  className?: string;
  showBackground?: boolean;
}

export default function HandLogo({ className = "w-full h-full", showBackground = false }: HandLogoProps) {
  return (
    <div className={`flex items-center justify-center ${showBackground ? 'bg-transparent' : ''}`}>
      <img 
        src="/logo.png" 
        alt="CTM Logo" 
        className={`object-contain ${className}`}
      />
    </div>
  );
}
