import type { RoboRequest } from '@robojs/server'

const transformUrlToProxy = (url: string) => {
  const file_extension = ".m3u8"
  return `/.proxy/api/bypass?url=${ btoa(url) }${file_extension}`
}

export default async (req: RoboRequest) => {
  const { url } = req.query
  if (!url || Array.isArray(url)) {
    throw new Error('URL is required')
  }

  // Fetch the HLS stream from the original source
  const response = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
    }
  })
  
  if (!response.ok) {
    return new Response(`Failed to fetch stream: ${response.statusText}`, {
      status: response.status
    })
  }
  
  // Get the content and check if it's a valid HLS playlist
  const content = await response.text()
  if (!content.includes('#EXTM3U')) {
    throw new Error('Invalid HLS stream')
  }
  
  // Return the response with the HLS URL and base64 image
  const result = {
    proxiedUrl: transformUrlToProxy(url), // Assuming no transformation needed
  }
  
  return result
}