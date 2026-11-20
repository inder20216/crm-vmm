import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import mysql from 'mysql2/promise'

const SERVICE_TYPES = ['AC AMC', 'Lift AMC', 'Pest Control AMC']

function vmmAmcApi(env) {
  let pool

  const db = () => {
    if (!pool) {
      pool = mysql.createPool({
        host: env.DB_HOST,
        port: Number(env.DB_PORT || 3306),
        user: env.DB_USER,
        password: env.DB_PASSWORD,
        database: env.DB_NAME || 'vmmdb',
        waitForConnections: true,
        connectionLimit: 5,
      })
    }
    return pool
  }

  const send = (res, status, payload) => {
    res.statusCode = status
    res.setHeader('Content-Type', 'application/json; charset=utf-8')
    res.end(JSON.stringify(payload))
  }

  const readBody = (req) => new Promise((resolve, reject) => {
    let raw = ''
    req.on('data', chunk => { raw += chunk })
    req.on('end', () => {
      try { resolve(raw ? JSON.parse(raw) : {}) } catch (err) { reject(err) }
    })
    req.on('error', reject)
  })

  return {
    name: 'vmm-amc-api',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const path = new URL(req.url || '/', 'http://localhost').pathname.replace(/^\/crm-vmm/, '')
        if (path !== '/api/amc-vendors') return next()

        try {
          if (req.method === 'GET') {
            const [rows] = await db().query(`
              SELECT store_code       AS storeCode,
                     store_name       AS storeName,
                     service_type     AS serviceType,
                     vendor_name      AS vendorName,
                     vendor_email     AS vendorEmail,
                     vendor_phone     AS vendorPhone
              FROM vmm_amc_vendors
              WHERE is_active = 1
              ORDER BY FIELD(service_type, 'AC AMC', 'Lift AMC', 'Pest Control AMC'), store_code
            `)
            return send(res, 200, {
              rows: rows.map(r => ({ ...r, id: `${r.serviceType}|${r.storeCode}` })),
              source: `${env.DB_NAME || 'vmmdb'}.vmm_amc_vendors`,
            })
          }

          if (req.method === 'POST') {
            const body = await readBody(req)
            const storeCode = String(body.storeCode || '').trim().toUpperCase()
            const serviceType = String(body.serviceType || '').trim()
            const vendorName = String(body.vendorName || '').trim()
            if (!storeCode || !SERVICE_TYPES.includes(serviceType) || !vendorName) {
              return send(res, 400, { success: false, error: 'storeCode, serviceType and vendorName are required' })
            }
            const values = [
              body.storeName || null,
              vendorName,
              body.vendorEmail || null,
              body.vendorPhone || null,
              storeCode,
              serviceType,
            ]
            const [result] = await db().query(`
              UPDATE vmm_amc_vendors
              SET store_name = ?, vendor_name = ?, vendor_email = ?, vendor_phone = ?,
                  updated_at = CURRENT_TIMESTAMP
              WHERE store_code = ? AND service_type = ?
            `, values)
            if (!result.affectedRows) {
              return send(res, 404, { success: false, error: 'AMC vendor row not found' })
            }
            return send(res, 200, {
              success: true,
              row: {
                id: `${serviceType}|${storeCode}`,
                storeCode,
                storeName: values[0],
                serviceType,
                vendorName,
                vendorEmail: values[2],
                vendorPhone: values[3],
              },
            })
          }

          return send(res, 405, { success: false, error: 'Method not allowed' })
        } catch (err) {
          console.error('[vmm-amc-api]', err)
          return send(res, 500, { success: false, error: err.message || 'AMC API failed' })
        }
      })
    },
  }
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  return {
    plugins: [react(), vmmAmcApi(env)],
    base: '/crm-vmm/',
    server: {
      proxy: {
        '/webhook': {
          target: 'https://automation.openmindhelpline.com',
          changeOrigin: true,
          secure: true,
        },
        '/cloud-webhook': {
          target: 'https://inder20216.app.n8n.cloud',
          changeOrigin: true,
          secure: true,
          rewrite: (path) => path.replace(/^\/cloud-webhook/, '/webhook'),
        }
      }
    }
  }
})
