// @vitest-environment node
import { describe, it, expect } from 'vitest'

// Import the pure parsing functions directly
const { parseSSOutput, parseLsofOutput, parseNetstatOutput } = require('../../../electron/utils/port-utils')

describe('port-utils', () => {
  describe('parseSSOutput', () => {
    it('should parse ss -tlnp output', () => {
      const output = `State    Recv-Q    Send-Q    Local Address:Port    Peer Address:Port    Process
LISTEN   0         511            0.0.0.0:3000         0.0.0.0:*        users:(("node",pid=1234,fd=20))
LISTEN   0         128          127.0.0.1:5432         0.0.0.0:*        users:(("postgres",pid=5678,fd=5))`

      const results = parseSSOutput(output)
      expect(results).toHaveLength(2)
      expect(results[0]).toEqual({ port: 3000, pid: 1234, processName: 'node', address: '0.0.0.0' })
      expect(results[1]).toEqual({ port: 5432, pid: 5678, processName: 'postgres', address: '127.0.0.1' })
    })

    it('should handle output with no process info', () => {
      const output = `State    Recv-Q    Send-Q    Local Address:Port    Peer Address:Port    Process
LISTEN   0         511            0.0.0.0:8080         0.0.0.0:*`

      const results = parseSSOutput(output)
      expect(results).toHaveLength(1)
      expect(results[0].port).toBe(8080)
      expect(results[0].pid).toBe(null)
      expect(results[0].processName).toBe(null)
    })

    it('should return empty for empty output', () => {
      expect(parseSSOutput('')).toEqual([])
    })

    it('should skip malformed lines', () => {
      const output = `State    Recv-Q    Send-Q    Local Address:Port    Peer Address:Port    Process
some garbage line
LISTEN   0         511            0.0.0.0:3000         0.0.0.0:*        users:(("node",pid=1234,fd=20))`

      const results = parseSSOutput(output)
      expect(results).toHaveLength(1)
      expect(results[0].port).toBe(3000)
    })
  })

  describe('parseLsofOutput', () => {
    it('should parse lsof output', () => {
      const output = `COMMAND   PID USER   FD   TYPE   DEVICE SIZE/OFF NODE NAME
node    12345 user   20u  IPv4  123456      0t0  TCP *:3000 (LISTEN)
postgres  678 user    5u  IPv4   78901      0t0  TCP 127.0.0.1:5432 (LISTEN)`

      const results = parseLsofOutput(output)
      expect(results).toHaveLength(2)
      expect(results[0]).toEqual({ port: 3000, pid: 12345, processName: 'node', address: '*' })
      expect(results[1]).toEqual({ port: 5432, pid: 678, processName: 'postgres', address: '127.0.0.1' })
    })

    it('should return empty for empty output', () => {
      expect(parseLsofOutput('')).toEqual([])
    })
  })

  describe('parseNetstatOutput', () => {
    it('should parse netstat -ano output', () => {
      const output = `  TCP    0.0.0.0:3000    0.0.0.0:0    LISTENING    1234
  TCP    127.0.0.1:5432  0.0.0.0:0    LISTENING    5678
  TCP    0.0.0.0:80      0.0.0.0:0    ESTABLISHED  9999`

      const results = parseNetstatOutput(output)
      expect(results).toHaveLength(2) // only LISTENING
      expect(results[0]).toEqual({ port: 3000, pid: 1234, processName: null, address: '0.0.0.0' })
      expect(results[1]).toEqual({ port: 5432, pid: 5678, processName: null, address: '127.0.0.1' })
    })

    it('should return empty for empty output', () => {
      expect(parseNetstatOutput('')).toEqual([])
    })
  })
})
