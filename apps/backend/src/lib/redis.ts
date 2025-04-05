import { Redis } from '@upstash/redis'

export const redis = new Redis({
  url: 'https://eminent-bull-38287.upstash.io',
  token: process.env.TOKEN
})

export const redisSub = new Redis({
    url: 'https://eminent-bull-38287.upstash.io',
    token: process.env.TOKEN
  })
