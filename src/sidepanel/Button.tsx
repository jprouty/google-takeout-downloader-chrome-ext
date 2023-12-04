import { useState, useEffect } from 'react'

import './Button.css'

export const Button = () => {
  const text = 'Download All';
  const iconName = 'file_download';
  // const iconName = 'cancel';

  return (
    <button>
      <i className="material-icons-extended" aria-hidden="true">{iconName}</i>
      <span className="button-text">{text}</span>
    </button>
  )
}

export default Button
