import mysql from 'mysql2/promise'
import { configured as teamsConfigured, postEmailPreview } from './teams.js'

const PX = 'vmm_'
const DEMO_DB = 'demo_vmm'

const TABLES = new Set([
  `${PX}products`, `${PX}natureofproblem`, `${PX}delayreasons`, `${PX}subdelayreasons`,
  `${PX}vendors`, `${PX}stores`, `${PX}facilitymanager`, `${PX}employees`,
  `${PX}vendorproducts`, `${PX}levelofescalation`, `${PX}levelofescalations`,
  `${PX}regions`, `${PX}states`, `${PX}complaints`,
  `${PX}complaintstores`, `${PX}complaintlogs`, `${PX}vendorescalations`,
  `${PX}users`, `${PX}amc_vendors`,
])

const RAW = (sql) => ({ __rawSql: sql })
const todayStamp = () => {
  const d = new Date()
  const p = n => String(n).padStart(2, '0')
  return `${String(d.getFullYear()).slice(2)}${p(d.getMonth() + 1)}${p(d.getDate())}`
}

function vmmDemoSqlApi(env) {
  const dbName = env.DB_NAME || DEMO_DB
  if (dbName !== DEMO_DB) {
    throw new Error(`Demo SQL API requires DB_NAME=${DEMO_DB}, got ${dbName}`)
  }

  let pool
  const columnCache = new Map()
  // Private signed workflow link. Never returned to the browser.
  const teamsWebhook = String(env.TEAMS_WEBHOOK_URL || '').trim()

  const db = () => {
    if (!pool) {
      pool = mysql.createPool({
        host: env.DB_HOST,
        port: Number(env.DB_PORT || 3306),
        user: env.DB_USER,
        password: env.DB_PASSWORD,
        database: dbName,
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
  const jsonSafe = (value) => {
    if (Buffer.isBuffer(value)) return value.toString('utf8')
    if (Array.isArray(value)) return value.map(jsonSafe)
    if (value && typeof value === 'object' && !(value instanceof Date)) {
      return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, jsonSafe(item)]))
    }
    return value
  }
  const ok = (res, data = {}) => send(res, 200, jsonSafe({ success: true, ...data }))
  const fail = (res, message, status = 400) => send(res, status, { success: false, error: String(message) })

  const readBody = (req) => new Promise((resolve, reject) => {
    let raw = ''
    req.on('data', chunk => { raw += chunk })
    req.on('end', () => {
      try { resolve(raw ? JSON.parse(raw) : {}) } catch (err) { reject(err) }
    })
    req.on('error', reject)
  })

  const all = async (sql, params = [], conn = db()) => (await conn.query(sql, params))[0]
  const one = async (sql, params = [], conn = db()) => {
    const rows = await all(sql, params, conn)
    return rows[0] || null
  }

  const tableColumns = async (table, conn = db(), useCache = true) => {
    if (!TABLES.has(table)) throw new Error(`Unsafe table: ${table}`)
    if (useCache && columnCache.has(table)) return columnCache.get(table)
    const rows = await all(`SHOW COLUMNS FROM \`${table}\``, [], conn)
    const names = rows.map(r => r.Field)
    columnCache.set(table, names)
    return names
  }

  const ensureCols = async (table, defs, conn = db()) => {
    const existing = await tableColumns(table, conn, false)
    for (const [name, definition] of Object.entries(defs)) {
      if (!existing.includes(name)) {
        await conn.query(`ALTER TABLE \`${table}\` ADD COLUMN \`${name}\` ${definition}`)
      }
    }
    columnCache.delete(table)
    return tableColumns(table, conn)
  }

  const insertAvailable = async (table, data, conn = db()) => {
    const fields = await tableColumns(table, conn)
    const entries = Object.entries(data).filter(([key, value]) => fields.includes(key) && value !== undefined)
    if (!entries.length) throw new Error(`No valid columns for ${table}`)
    const cols = entries.map(([key]) => `\`${key}\``).join(', ')
    const values = entries.map(([, value]) => (value && value.__rawSql ? value.__rawSql : '?')).join(', ')
    const params = entries
      .filter(([, value]) => !(value && value.__rawSql))
      .map(([, value]) => value)
    const [result] = await conn.query(`INSERT INTO \`${table}\` (${cols}) VALUES (${values})`, params)
    return result.insertId
  }

  const nextComplaintNo = async (conn, prefixCode = '') => {
    let cno
    try {
      await conn.query('CALL generateReferenceNo(@lastid)')
      const gen = await one('SELECT @lastid AS cno', [], conn)
      cno = gen?.cno
    } catch {
      const gen = await one(`SELECT COALESCE(MAX(id), 0) + 1 AS cno FROM ${PX}complaints`, [], conn)
      cno = gen?.cno
    }
    const base = `${todayStamp()}${cno || '1'}`
    const prefix = String(prefixCode || '').trim()
    return prefix ? `${prefix}-${base}` : base
  }

  const latestLogJoin = `
    JOIN (
      SELECT * FROM ${PX}complaintlogs l1
      WHERE l1.id = (
        SELECT MAX(l2.id) FROM ${PX}complaintlogs l2
        WHERE l2.complaintid = l1.complaintid AND l2.is_deleted = 'No'
      )
    ) l ON l.complaintid = c.id`

  const latestEscJoin = `
    LEFT JOIN (
      SELECT * FROM ${PX}vendorescalations e1
      WHERE e1.id = (
        SELECT MAX(e2.id) FROM ${PX}vendorescalations e2
        WHERE e2.complaintid = e1.complaintid AND e2.is_deleted = 'No'
      )
    ) esc ON esc.complaintid = c.id`

  const hasTable = async (table, conn = db()) => {
    try {
      await tableColumns(table, conn, false)
      return true
    } catch {
      return false
    }
  }

  const delayReasonData = async (conn = db()) => {
    const reasons = await all(`SELECT id, name, tat FROM ${PX}delayreasons WHERE is_deleted='No' AND pid=0 ORDER BY name`, [], conn)
    let sub
    if (await hasTable(`${PX}subdelayreasons`, conn)) {
      sub = await all(`SELECT id, reasonid, name, tat FROM ${PX}subdelayreasons WHERE is_deleted='No' ORDER BY name`, [], conn)
    } else {
      sub = await all(`SELECT id, pid AS reasonid, name, tat FROM ${PX}delayreasons WHERE is_deleted='No' AND pid>0 ORDER BY name`, [], conn)
    }
    return { reasons, sub }
  }

  const subTat = (value, fallback) => {
    const raw = value === '' || value == null ? fallback : value
    if (raw == null || raw === '') return null
    const text = String(raw).trim()
    return /^\d+$/.test(text) ? Number(text) : text
  }

  const requirePost = (req, res) => {
    if (req.method !== 'POST') {
      fail(res, 'POST required', 405)
      return false
    }
    return true
  }

  const handle = async (req, res, action, params, body) => {
    switch (action) {
      // ── Teams preview (like LOTS CRM — email previews go to Teams, not mail) ─
      case 'vmm-teams-status': {
        const ready = teamsConfigured(teamsWebhook)
        return ok(res, { configured: ready, enabled: ready })
      }

      case 'vmm-teams-preview': {
        if (!requirePost(req, res)) return
        if (!teamsConfigured(teamsWebhook)) return fail(res, 'Teams webhook not configured', 503)
        try {
          await postEmailPreview(teamsWebhook, body)
          return ok(res, { preview: true })
        } catch (err) {
          console.error('[vmm-teams-preview]', err)
          return fail(res, `Teams post failed: ${err?.message || 'unknown error'}`, 502)
        }
      }

      // ── Reference data ───────────────────────────────────────────────────────
      case 'vmm-sp-products': {
        const rows = await all(`SELECT id, name, shortName, shortName AS code FROM ${PX}products WHERE is_deleted='No' AND status='1' ORDER BY name`)
        return ok(res, { products: rows })
      }

      case 'vmm-sp-natures': {
        await ensureCols(`${PX}natureofproblem`, { type: 'VARCHAR(255) NULL AFTER name', tat_days: 'INT NULL AFTER type' })
        const rows = await all(`SELECT id, name, name AS nature, type, tat_days FROM ${PX}natureofproblem WHERE is_deleted='No' ORDER BY name`)
        return ok(res, { natures: rows })
      }

      case 'vmm-sp-delay-reasons': {
        const { reasons, sub } = await delayReasonData()
        return ok(res, { reasons, subReasons: sub })
      }

      case 'vmm-master-data': {
        await ensureCols(`${PX}natureofproblem`, { type: 'VARCHAR(255) NULL AFTER name', tat_days: 'INT NULL AFTER type' })
        const natures = await all(`SELECT id, name AS nature, type, tat_days FROM ${PX}natureofproblem WHERE is_deleted='No' ORDER BY name`)
        const complaintTypes = [...new Set(natures.map(n => n.type).filter(Boolean))]
        const { reasons, sub } = await delayReasonData()
        const delayReasons = {}
        for (const main of reasons) {
          const subs = sub.filter(x => Number(x.reasonid) === Number(main.id))
          if (!subs.length) continue
          delayReasons[main.name] = subs.map(x => ({ label: x.name, tat: subTat(x.tat, main.tat) }))
        }
        return ok(res, { natures, complaintTypes, delayReasons })
      }

      case 'vmm-master-save': {
        if (!requirePost(req, res)) return
        const sheet = String(body.sheet || '')
        const actionName = String(body.action || 'create')
        const row = body.row || {}
        if (!sheet || typeof row !== 'object') return fail(res, 'sheet and row required')

        if (sheet === 'Nature') {
          const nature = String(row.nature || '').trim()
          if (!nature) return fail(res, 'nature required')
          const type = String(row.type || 'Repair')
          const tat = row.tatDays === '' || row.tatDays == null ? null : Number(row.tatDays)
          if (actionName === 'delete') {
            await db().query(`UPDATE ${PX}natureofproblem SET is_deleted='Yes' WHERE name=?`, [nature])
          } else {
            await ensureCols(`${PX}natureofproblem`, { type: 'VARCHAR(255) NULL', tat_days: 'INT NULL' })
            const exists = await one(`SELECT id FROM ${PX}natureofproblem WHERE name=? AND is_deleted='No' LIMIT 1`, [nature])
            if (exists) {
              await db().query(`UPDATE ${PX}natureofproblem SET type=?, tat_days=?, is_deleted='No' WHERE name=?`, [type, tat, nature])
            } else {
              await insertAvailable(`${PX}natureofproblem`, {
                name: nature, type, tat_days: tat, is_deleted: 'No', status: 1,
                created: RAW('NOW()'), updated: RAW('NOW()'),
              })
            }
          }
          return ok(res)
        }

        if (sheet === 'ComplaintType') return ok(res)

        if (sheet === 'DelayReason') {
          const main = String(row.main || '').trim()
          const label = String(row.label || '').trim()
          if (!main) return fail(res, 'main required')
          const tat = row.tat === '' || row.tat == null ? null : Number(row.tat)
          const subTable = await hasTable(`${PX}subdelayreasons`)
          const subRef = subTable ? `${PX}subdelayreasons` : `${PX}delayreasons`
          const subKey = subTable ? 'reasonid' : 'pid'
          const mainFilter = subTable ? '' : 'pid=0 AND '
          if (actionName === 'delete') {
            const dm = await one(`SELECT id FROM ${PX}delayreasons WHERE ${mainFilter}name=? AND is_deleted='No' LIMIT 1`, [main])
            if (dm) {
              if (label) {
                await db().query(`UPDATE ${subRef} SET is_deleted='Yes' WHERE ${subKey}=? AND name=?`, [dm.id, label])
              } else {
                await db().query(`UPDATE ${subRef} SET is_deleted='Yes' WHERE ${subKey}=?`, [dm.id])
                await db().query(`UPDATE ${PX}delayreasons SET is_deleted='Yes' WHERE id=?`, [dm.id])
              }
            }
          } else {
            if (!label) return fail(res, 'label required for delay reason')
            let dm = await one(`SELECT id FROM ${PX}delayreasons WHERE ${mainFilter}name=? AND is_deleted='No' LIMIT 1`, [main])
            if (!dm) {
              const id = await insertAvailable(`${PX}delayreasons`, {
                name: main, ...(subTable ? { tat } : { pid: 0 }), is_deleted: 'No', status: 1,
                created: RAW('NOW()'), updated: RAW('NOW()'),
              })
              dm = { id }
            } else if (subTable) {
              await db().query(`UPDATE ${PX}delayreasons SET tat=?, is_deleted='No' WHERE id=?`, [tat, dm.id])
            }
            const sub = await one(`SELECT id FROM ${subRef} WHERE ${subKey}=? AND name=? AND is_deleted='No' LIMIT 1`, [dm.id, label])
            if (sub) {
              await db().query(`UPDATE ${subRef} SET ${subTable ? "is_deleted='No'" : "tat=?, is_deleted='No'"} WHERE id=?`, subTable ? [sub.id] : [tat, sub.id])
            } else {
              await insertAvailable(subRef, {
                [subKey]: dm.id, name: label, tat, is_deleted: 'No', status: 1,
                created: RAW('NOW()'), updated: RAW('NOW()'),
              })
            }
          }
          return ok(res)
        }

        return fail(res, `Unknown sheet: ${sheet}`, 404)
      }

      case 'vmm-sp-vendors': {
        const rows = await all(`SELECT id, name FROM ${PX}vendors WHERE is_deleted='No' AND status='1' ORDER BY name`)
        return ok(res, { vendors: rows })
      }

      case 'vmm-sp-store': {
        const code = String(params.code || '').trim()
        if (!code) return fail(res, 'code required')
        const store = await one(`
          SELECT s.id, s.code, s.name AS storename, s.email AS storeemail, s.address, s.city,
                 r.name AS regionname, st.name AS statename, s.openingdate, s.managername, s.managermobileno,
                 s.asmname, s.asmmobileno,
                 fm.id AS fmid, fm.name AS fmname, fm.email AS fmemail,
                 fm.mobileno AS fmmobileno, fm.city AS fmcity
          FROM ${PX}stores s
          LEFT JOIN ${PX}regions r ON r.id=s.regionid AND r.is_deleted='No'
          LEFT JOIN ${PX}states st ON st.id=s.stateid AND st.is_deleted='No'
          LEFT JOIN ${PX}facilitymanager fm ON fm.id = s.fmid AND fm.is_deleted='No'
          WHERE s.code=? AND s.is_deleted='No' AND s.status='1' LIMIT 1`, [code])
        if (!store) return fail(res, 'Store not found', 404)
        // Normalise the SQL aliases to the camelCase names used by both the
        // New Case form and the Email Complaints escalation preview.
        return ok(res, {
          store: {
            ...store,
            name: store.storename,
            email: store.storeemail,
            smEmail: store.storeemail,
            region: store.regionname,
            state: store.statename,
            fmName: store.fmname,
            fmEmail: store.fmemail,
            fmMobile: store.fmmobileno,
            fmCity: store.fmcity,
          },
        })
      }

      case 'vmm-sp-employee': {
        const code = String(params.code || '').trim()
        const mobile = String(params.mobile || '').trim()
        const fields = 'SELECT id, code, name, mobileno, email, alternative, designation'
        // New Case smart search needs a store code on the employee record to
        // enrich store details. Derive the most recent assigned store locally.
        const withStore = async (employee) => {
          if (!employee) return employee
          const cs = await one(
            `SELECT storecode, storename FROM ${PX}complaintstores
             WHERE empid=? AND is_deleted='No' ORDER BY id DESC LIMIT 1`,
            [employee.id]
          )
          // Different screens consume both the raw SQL names and camelCase aliases.
          return {
            ...employee,
            mobile: employee.mobile || employee.mobileno || '',
            mobileno: employee.mobileno || employee.mobile || '',
            storecode: cs?.storecode || employee.storecode || '',
            storename: cs?.storename || employee.storename || '',
            storeCode: cs?.storecode || employee.storecode || '',
            storeName: cs?.storename || employee.storename || '',
          }
        }
        if (code) {
          const employee = await withStore(await one(`${fields} FROM ${PX}employees WHERE code=? AND is_deleted='No' AND status='1' LIMIT 1`, [code]))
          if (!employee) return fail(res, 'Employee not found', 404)
          // The email wizard checks `found`, like the live API does.
          return ok(res, { found: true, employee })
        }
        if (mobile) {
          const employee = await withStore(await one(`${fields} FROM ${PX}employees WHERE mobileno=? AND is_deleted='No' AND status='1' LIMIT 1`, [mobile]))
          if (!employee) return fail(res, 'Employee not found', 404)
          return ok(res, { found: true, employee })
        }
        const employees = await all(`${fields} FROM ${PX}employees WHERE is_deleted='No' AND status='1' ORDER BY name`)
        return ok(res, { employees })
      }

      case 'vmm-sp-amc-vendor': {
        return ok(res, { vendor: null })
      }

      case 'vmm-sp-escalation-matrix': {
        const product = String(params.product || '').trim()
        const vendorId = String(params.vendorId || '').trim()

        if (await hasTable(`${PX}levelofescalation`)) {
          const where = ["vp.is_deleted='No'", "vp.status='1'"]
          const values = []
          if (product) { where.push('p.name=?'); values.push(product) }
          if (vendorId) { where.push('vp.vendorid=?'); values.push(vendorId) }
          const matrix = await all(`
            SELECT vp.id, vp.code, p.name AS productname, v.name AS vendorname, vp.vendorid,
                   el.escalationlevel, el.emailids, el.ccemailids, el.tat
            FROM ${PX}vendorproducts vp
            JOIN ${PX}products p ON p.id=vp.productId AND p.is_deleted='No'
            JOIN ${PX}vendors v ON v.id=vp.vendorId AND v.is_deleted='No'
            LEFT JOIN ${PX}levelofescalation el ON el.vendorproductid=vp.id AND el.is_deleted='No'
            WHERE ${where.join(' AND ')} ORDER BY el.escalationlevel`, values)
          return ok(res, { matrix })
        }

        const where = ["loe.is_deleted='No'", "loe.status='1'"]
        const values = []
        if (vendorId) { where.push('loe.vendorid=?'); values.push(vendorId) }
        if (product) {
          where.push(`EXISTS (
            SELECT 1 FROM ${PX}vendorproducts vp
            JOIN ${PX}products p ON p.id=vp.productId AND p.is_deleted='No'
            WHERE vp.vendorId=loe.vendorid AND p.name=?
              AND vp.is_deleted='No' AND vp.status='1')`)
          values.push(product)
        }
        const matrix = await all(`
          SELECT loe.id, loe.vendorid, v.name AS vendorName,
                 loe.contactperson AS contactPerson, loe.email, loe.region,
                 loe.escalationlevel AS level, loe.mobileno1 AS mobile1,
                 loe.customercareno AS customerCareNo, loe.city, loe.stateid
          FROM ${PX}levelofescalations loe
          JOIN ${PX}vendors v ON v.id=loe.vendorid AND v.is_deleted='No'
          WHERE ${where.join(' AND ')}
          ORDER BY v.name, loe.escalationlevel, loe.id`, values)
        return ok(res, { matrix })
      }

      case 'vmm-generate-comp-no': {
        const conn = await db().getConnection()
        try {
          return ok(res, { complaintno: await nextComplaintNo(conn) })
        } finally {
          conn.release()
        }
      }

      // ── Complaint writes ──────────────────────────────────────────────────────
      case 'vmm-log-complaint': {
        if (!requirePost(req, res)) return
        // Accept both the n8n payload (IDs) and the New Case form payload
        // (codes/names) so local UI logging works against demo_vmm.
        const b = { ...body }
        const conn = await db().getConnection()
        try {
          const storeCode = String(b.storeCode || '').trim()
          const employeeCode = String(b.employeeCode || '').trim()
          const productName = String(b.productName || '').trim()
          const productCode = String(b.productShortName || '').trim()

          if (!b.storeId && !b.storerefid && storeCode) {
            const store = await one(`SELECT id FROM ${PX}stores WHERE code=? AND is_deleted='No' LIMIT 1`, [storeCode], conn)
            if (store) b.storeId = store.id
          }
          if (!b.empId && employeeCode) {
            const emp = await one(`SELECT id, email, mobileno FROM ${PX}employees WHERE code=? AND is_deleted='No' LIMIT 1`, [employeeCode], conn)
            if (emp) {
              b.empId = emp.id
              b.empEmail = b.empEmail || emp.email
              b.empContactNo = b.empContactNo || b.contactNumber || emp.mobileno
            }
          }
          if (!b.productid && (productName || productCode)) {
            const product = await one(
              `SELECT id, name, shortName FROM ${PX}products
               WHERE is_deleted='No' AND (name=? OR shortName=?) LIMIT 1`,
              [productName, productCode], conn
            )
            if (product) {
              b.productid = product.id
              b.productCode = b.productCode || product.shortName || ''
              b.productname = b.productname || product.name
            }
          }
          b.productname = b.productname || productName
          b.productCode = b.productCode || productCode
          b.producttype = b.producttype || b.productType || ''
          b.typeOfComplaints = b.typeOfComplaints || b.complaintType || ''
          b.natureOfProblem = b.natureOfProblem || b.natureOfComplaint || ''
          b.tat = b.tat || b.tatDays
          b.description = b.description || b.remarks || ''
          b.subject = b.subject || b.emailSubject || ''
          b.sourceOfComplaints = b.sourceOfComplaints || b.source || ''
          b.empContactNo = b.empContactNo || b.contactNumber || ''

          const complaintno = await nextComplaintNo(conn, b.prefixCode)
          let storerefid = Number(b.storerefid || 0)

          if (!storerefid) {
            const storeId = Number(b.storeId || 0)
            const empId = Number(b.empId || 0)
            const emp = await one(`SELECT * FROM ${PX}employees WHERE id=? AND is_deleted='No' LIMIT 1`, [empId], conn)
            const store = await one(`
              SELECT s.*, r.name AS regionname, st.name AS statename,
                     fm.name AS fmname, fm.email AS fmemail,
                     fm.mobileno AS fmmobileno, fm.city AS fmcity
              FROM ${PX}stores s
              LEFT JOIN ${PX}regions r ON r.id=s.regionid AND r.is_deleted='No'
              LEFT JOIN ${PX}states st ON st.id=s.stateid AND st.is_deleted='No'
              LEFT JOIN ${PX}facilitymanager fm ON fm.id=s.fmid AND fm.is_deleted='No'
              WHERE s.id=? AND s.is_deleted='No' LIMIT 1`, [storeId], conn)
            if (!emp || !store) return fail(res, 'Employee or store not found', 404)

            storerefid = await insertAvailable(`${PX}complaintstores`, {
              empid: emp.id, empcode: emp.code, empname: emp.name,
              sourceofcomplaints: b.sourceOfComplaints || '',
              empmobileno: b.empContactNo || emp.mobileno,
              empemail: b.empEmail || emp.email,
              emptalternativeno: emp.alternative || '',
              empdesignation: emp.designation || '',
              storeid: store.id, storecode: store.code, storename: store.name,
              storeemail: store.email, storeaddress: store.address || '',
              storecity: store.city || '', storeregion: store.regionname || '',
              statename: store.statename || '', openingdate: store.openingdate || '',
              managername: store.managername || '', managermobileno: store.managermobileno || '',
              asmname: store.asmname || '', asmmobileno: store.asmmobileno || '',
              fmid: store.fmid || 0, fmname: store.fmname || '', fmemail: store.fmemail || '',
              fmmobileno: store.fmmobileno || '', fmcity: store.fmcity || '',
              sourceofctxnid: b.txnid || '', sourceofcsubject: b.subject || '',
              sourceofcmobileno: b.mobileno || '', uid: Number(b.uid || 1),
              created: RAW('NOW()'), updated: RAW('NOW()'), is_deleted: 'No',
            }, conn)
          }

          await conn.beginTransaction()
          try {
            const complaintid = await insertAvailable(`${PX}complaints`, {
              complaintno, storerefid,
              productid: Number(b.productid || 0),
              productcode: b.productCode || '', productname: b.productname || '',
              producttype: b.producttype || '', vendorname: b.vendorName || '',
              vendorid: Number(b.vendorId || 0), productmodel: b.productModel || '',
              productlocation: b.productLocation || '',
              typeofcomplaint: b.typeOfComplaints || '',
              natureofproblem: b.natureOfProblem || '',
              tat: Number(b.tat || 0), description: b.description || '',
              uid: Number(b.uid || 1), created: RAW('NOW()'), updated: RAW('NOW()'), is_deleted: 'No',
            }, conn)

            await insertAvailable(`${PX}complaintlogs`, {
              complaintid, status: 'Logged', currentstatus: 1, fupdonevia: '',
              subject: '', remarks: b.remarks || '', uid: Number(b.uid || 1),
              created: RAW('NOW()'), updated: RAW('NOW()'), is_deleted: 'No',
            }, conn)

            await conn.commit()
            return ok(res, { complaintno, complaintid })
          } catch (err) {
            await conn.rollback()
            throw err
          }
        } finally {
          conn.release()
        }
      }

      case 'vmm-get-complaint': {
        const complaintno = String(params.complaintno || '').trim()
        if (!complaintno) return fail(res, 'complaintno required')
        const complaint = await one(`
          SELECT c.*, s.storename, s.storecode, s.storeemail, s.fmname, s.fmemail, s.fmmobileno,
                 s.empname, s.empmobileno, l.status, l.remarks, l.created AS log_created
          FROM ${PX}complaints c
          JOIN ${PX}complaintstores s ON s.id=c.storerefid
          ${latestLogJoin}
          WHERE c.is_deleted='No' AND c.complaintno=? LIMIT 1`, [complaintno])
        if (!complaint) return fail(res, 'Complaint not found', 404)
        return ok(res, { complaint })
      }

      case 'vmm-update-complaint':
      case 'vmm-escalate-complaint':
      case 'vmm-close-complaint': {
        if (!requirePost(req, res)) return
        const b = body
        const complaintid = Number(b.complaintId || 0)
        if (!complaintid) return fail(res, 'complaintId required')
        const isEscalate = action === 'vmm-escalate-complaint'
        const isClose = action === 'vmm-close-complaint'
        const status = isEscalate ? 'Escalated' : isClose ? String(b.closureStatus || 'Closed') : String(b.status || 'Updated')
        const logid = await insertAvailable(`${PX}complaintlogs`, {
          complaintid, status, currentstatus: 1,
          fupdonevia: b.followupMethod || 'Call',
          subject: b.emailSubject || '', mobileno: b.mobileCalled || '',
          txnid: b.txnId || '', reasonfordelay: b.delayMain || '',
          subreasonfordelay: b.delaySub || '',
          caseclosedby: isClose ? b.closedBy || '' : undefined,
          closureinformdate: isClose ? (b.closureDate || RAW('NULL')) : undefined,
          remarks: b.remarks || '', uid: Number(b.uid || 1),
          created: RAW('NOW()'), updated: RAW('NOW()'), is_deleted: 'No',
        })

        const ticketno = String(b.vendorTicketNo || '')
        const newEdc = String(b.newClosureDate || '')
        if (ticketno && !newEdc) {
          await db().query(`
            UPDATE ${PX}vendorescalations SET ticketno=?
            WHERE id=(SELECT MAX(id) FROM (SELECT id FROM ${PX}vendorescalations WHERE complaintid=?) t)`,
          [ticketno, complaintid])
        }
        if (isEscalate || (isClose && status === 'Partially Closed' && newEdc)) {
          await insertAvailable(`${PX}vendorescalations`, {
            logid, complaintid, escalationlevel: Number(b.escalationLevel || 1),
            ticketno, closuredate: newEdc || RAW('NULL'), uid: Number(b.uid || 1),
            uuid: 0, created: RAW('NOW()'), updated: RAW('NOW()'), is_deleted: 'No',
          })
        }
        return ok(res, { complaintId: complaintid, status })
      }

      case 'vmm-not-connected': {
        if (!requirePost(req, res)) return
        const complaintid = Number(body.complaintId || 0)
        if (!complaintid) return fail(res, 'complaintId required')
        await insertAvailable(`${PX}complaintlogs`, {
          complaintid, status: 'Updated', currentstatus: 1, fupdonevia: 'Call',
          remarks: 'Not Connected', uid: Number(body.uid || 1),
          created: RAW('NOW()'), updated: RAW('NOW()'), is_deleted: 'No',
        })
        return ok(res)
      }

      case 'vmm-update-edc': {
        if (!requirePost(req, res)) return
        const complaintid = Number(body.complaintId || 0)
        const newEdc = String(body.newClosureDate || '').trim()
        if (!complaintid || !newEdc) return fail(res, 'complaintId and newClosureDate required')
        const esc = await one(`SELECT id FROM ${PX}vendorescalations WHERE complaintid=? ORDER BY id DESC LIMIT 1`, [complaintid])
        if (esc) await db().query(`UPDATE ${PX}vendorescalations SET closuredate=? WHERE id=?`, [newEdc, esc.id])
        return ok(res)
      }

      // ── Complaint reads ───────────────────────────────────────────────────────
      case 'vmm-followup-complaints': {
        const complaints = await all(`
          SELECT c.id, c.complaintno, c.productname, c.vendorname, c.created,
                 s.storecode, s.storename, s.fmname,
                 l.status, l.remarks, l.created AS last_updated,
                 esc.closuredate AS edc, esc.ticketno, esc.escalationlevel
          FROM ${PX}complaints c
          JOIN ${PX}complaintstores s ON s.id=c.storerefid AND s.is_deleted='No'
          ${latestLogJoin} ${latestEscJoin}
          WHERE c.is_deleted='No' AND l.status NOT IN ('Closed')
          ORDER BY c.id DESC`, [])
        return ok(res, { complaints })
      }

      case 'vmm-search-complaints': {
        const where = ["c.is_deleted='No'"]
        const values = []
        if (params.store) {
          where.push('s.storecode=?')
          values.push(String(params.store).trim().toUpperCase())
        }
        if (params.q) {
          const q = `%${params.q}%`
          where.push(`(c.complaintno LIKE ? OR s.storecode LIKE ? OR s.storename LIKE ? OR c.productname LIKE ? OR esc.ticketno LIKE ?)`)
          values.push(q, q, q, q, q)
        }
        if (params.from) { where.push('c.created >= ?'); values.push(`${params.from} 00:00:00`) }
        if (params.to) { where.push('c.created <= ?'); values.push(`${params.to} 23:59:59`) }
        if (params.status) { where.push('l.status=?'); values.push(params.status) }
        if (params.edc) { where.push('esc.closuredate <= ?'); values.push(`${params.edc} 23:59:59`) }
        const complaints = await all(`
          SELECT c.id, c.complaintno, c.productname, c.vendorname, c.created,
                 s.storecode, s.storename, s.fmname,
                 l.status, l.remarks, esc.closuredate AS edc, esc.ticketno,
                 DATEDIFF(NOW(), c.created) AS aging
          FROM ${PX}complaints c
          JOIN ${PX}complaintstores s ON s.id=c.storerefid AND s.is_deleted='No'
          ${latestLogJoin} ${latestEscJoin}
          WHERE ${where.join(' AND ')} ORDER BY c.id DESC LIMIT 500`, values)
        return ok(res, { complaints })
      }

      case 'vmm-complaint-detail': {
        const no = String(params.no || '').trim()
        if (!no) return fail(res, 'no required')
        const complaint = await one(`
          SELECT c.*, s.storename, s.storecode, s.storeemail, s.fmname, s.fmemail, s.fmmobileno,
                 s.empname, s.empmobileno, s.managername, s.managermobileno,
                 s.storeaddress, s.storecity, s.fmcity, s.asmname, s.asmmobileno, s.statename
          FROM ${PX}complaints c JOIN ${PX}complaintstores s ON s.id=c.storerefid
          WHERE c.is_deleted='No' AND (c.complaintno=? OR c.id=?) LIMIT 1`, [no, no])
        if (!complaint) return fail(res, 'Not found', 404)
        const logs = await all(`
          SELECT l.*, u.name AS agentname, esc.ticketno, esc.escalationlevel, esc.closuredate
          FROM ${PX}complaintlogs l
          LEFT JOIN ${PX}users u ON u.id=l.uid AND u.is_deleted='No'
          LEFT JOIN ${PX}vendorescalations esc ON esc.logid=l.id AND esc.is_deleted='No'
          WHERE l.is_deleted='No' AND l.complaintid=? ORDER BY l.id`, [complaint.id])
        return ok(res, { complaint, logs })
      }

      case 'vmm-dashboard-stats': {
        const from = String(params.from || `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}-01`)
        const to = String(params.to || new Date().toISOString().slice(0, 10))
        const logged = await one(`SELECT COUNT(*) AS cnt FROM ${PX}complaints WHERE is_deleted='No' AND DATE(created) BETWEEN ? AND ?`, [from, to])
        const open = await one(`
          SELECT COUNT(*) AS cnt FROM ${PX}complaints c ${latestLogJoin}
          WHERE c.is_deleted='No' AND l.status NOT IN ('Closed')`)
        const closed = await one(`
          SELECT COUNT(*) AS cnt FROM ${PX}complaints c ${latestLogJoin}
          WHERE c.is_deleted='No' AND l.status='Closed' AND DATE(l.created) BETWEEN ? AND ?`, [from, to])
        const escalated = await one(`
          SELECT COUNT(*) AS cnt FROM ${PX}complaints c ${latestLogJoin}
          WHERE c.is_deleted='No' AND l.status='Escalated'`)
        return ok(res, {
          logged: Number(logged?.cnt || 0),
          open: Number(open?.cnt || 0),
          closed: Number(closed?.cnt || 0),
          escalated: Number(escalated?.cnt || 0),
        })
      }

      case 'vmm-user-role': {
        const email = String(params.email || '').trim()
        if (!email) return fail(res, 'email required')
        const cols = await tableColumns(`${PX}users`)
        const roleExpr = cols.includes('role') ? 'role' : cols.includes('type') ? 'type AS role' : "'' AS role"
        const user = await one(`SELECT id, name, email, ${roleExpr} FROM ${PX}users WHERE email=? AND is_deleted='No' AND status='1' LIMIT 1`, [email])
        if (!user) return fail(res, 'User not found', 404)
        return ok(res, { user, role: user.role })
      }

      case 'vmm-sparktg-inbound': {
        const mobile = String(params.mobile || '').trim()
        if (!mobile) return fail(res, 'mobile required')
        const employee = await one(`SELECT id, code, name, mobileno, email, designation FROM ${PX}employees WHERE mobileno=? AND is_deleted='No' AND status='1' LIMIT 1`, [mobile])
        let store = null
        if (employee) {
          store = await one(`
            SELECT s.id, s.code, s.name
            FROM ${PX}stores s
            JOIN ${PX}complaintstores cs ON cs.storeid=s.id AND cs.empid=?
            WHERE s.is_deleted='No' ORDER BY cs.id DESC LIMIT 1`, [employee.id])
        }
        return ok(res, { employee, store })
      }

      case 'vmm-ai-polish':
        return ok(res, { polished: String(body.text || '') })

      default:
        return fail(res, `Unknown action: ${action}`, 404)
    }
  }

  return {
    name: 'vmm-demo-sql-api',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const url = new URL(req.url || '/', 'http://localhost')
        const path = url.pathname.replace(/^\/crm-vmm/, '')
        const match = path.match(/^\/demo-api\/([A-Za-z0-9_-]+)\/?$/)
        if (!match) return next()

        if (req.method === 'OPTIONS') return send(res, 200, {})
        const action = match[1]
        const params = Object.fromEntries(url.searchParams.entries())
        let body = {}
        if (req.method === 'POST' || req.method === 'PUT' || req.method === 'PATCH') {
          try {
            body = await readBody(req)
          } catch {
            return fail(res, 'Invalid JSON body')
          }
        }

        try {
          await handle(req, res, action, params, body)
        } catch (err) {
          console.error('[vmm-demo-sql-api]', action, err)
          if (!res.writableEnded) fail(res, err.message || 'Demo SQL API failed', 500)
        }
      })
    },
  }
}

export { vmmDemoSqlApi }
