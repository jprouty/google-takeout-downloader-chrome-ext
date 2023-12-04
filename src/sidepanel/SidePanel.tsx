import { useState, useEffect } from 'react'
import Button from './Button'

import './SidePanel.css'

export const SidePanel = () => {
  const [countSync, setCountSync] = useState(0)
  const link = 'https://github.com/guocaoyi/create-chrome-ext'

  useEffect(() => {
    chrome.storage.sync.get(['count'], (result) => {
      setCountSync(result.count || 0)
    })

    chrome.runtime.onMessage.addListener((request) => {
      if (request.type === 'COUNT') {
        setCountSync(request.count || 0)
      }
    })
  }, [])

  return (
    <main>
      <Button></Button>
    </main>
  )
}

export default SidePanel