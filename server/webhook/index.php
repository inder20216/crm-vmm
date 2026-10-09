<?php
/**
 * VMM CRM — PHP Webhook Router
 * Drop this file + .htaccess into /webhook/ on vmm.openmindservices.in
 * Replaces all n8n workflows for core CRM operations.
 */

// ── CORS ──────────────────────────────────────────────────────────────────────
$allowed = ['https://inder20216.github.io', 'http://localhost:5173', 'http://localhost:5174'];
$origin  = $_SERVER['HTTP_ORIGIN'] ?? '';
if (in_array($origin, $allowed)) {
    header("Access-Control-Allow-Origin: $origin");
} else {
    header("Access-Control-Allow-Origin: https://inder20216.github.io");
}
header("Access-Control-Allow-Methods: GET, POST, OPTIONS");
header("Access-Control-Allow-Headers: Content-Type, Authorization");
header("Content-Type: application/json; charset=utf-8");

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { http_response_code(200); exit; }

// ── DB ────────────────────────────────────────────────────────────────────────
require_once __DIR__ . '/../common/constraints/dbconfig.php';
$db = mysqli_connect(constant('dbhost'), constant('dbusername'), constant('dbpassword'), constant('dbname'));
if (!$db) { http_response_code(500); echo json_encode(['success'=>false,'error'=>'DB connection failed']); exit; }
mysqli_select_db($db, 'vmmdb');
mysqli_set_charset($db, 'utf8mb4');
$px = 'vmm_';

// ── Helpers ───────────────────────────────────────────────────────────────────
function ok($data = [])  { echo json_encode(array_merge(['success'=>true], $data)); exit; }
function fail($msg, $code = 400) { http_response_code($code); echo json_encode(['success'=>false,'error'=>$msg]); exit; }
function e($db, $v)       { return mysqli_real_escape_string($db, (string)($v ?? '')); }
function q($db, $sql)     { $r = mysqli_query($db, $sql); if (!$r) throw new Exception(mysqli_error($db)); return $r; }
function rows($db, $sql)  { $r = q($db,$sql); $a=[]; while($row=mysqli_fetch_assoc($r)) $a[]=$row; return $a; }
function row($db, $sql)   { $r = q($db,$sql); return mysqli_fetch_assoc($r) ?: null; }
function now_()           { return date('Y-m-d H:i:s'); }
function ensureCols($db, $table, $cols) {
    $existing = [];
    $r = q($db, "SHOW COLUMNS FROM `$table`");
    while ($row = mysqli_fetch_assoc($r)) $existing[] = $row['Field'];
    foreach ($cols as $name => $def) {
        if (!in_array($name, $existing, true)) q($db, "ALTER TABLE `$table` ADD COLUMN `$name` $def");
    }
    return $existing;
}
function tableFields($db, $table) {
    $fields = [];
    $r = q($db, "SHOW COLUMNS FROM `$table`");
    while ($row = mysqli_fetch_assoc($r)) $fields[] = $row['Field'];
    return $fields;
}
function insertAvailable($db, $table, $data) {
    $fields = tableFields($db, $table);
    $cols = []; $vals = [];
    foreach ($data as $k => $v) {
        if (!in_array($k, $fields, true)) continue;
        $cols[] = "`$k`";
        $vals[] = ($v === null || $v === '') ? 'NULL' : "'" . e($db, $v) . "'";
    }
    q($db, "INSERT INTO `$table` (" . implode(',', $cols) . ") VALUES (" . implode(',', $vals) . ")");
    return mysqli_insert_id($db);
}

// ── Route ─────────────────────────────────────────────────────────────────────
$uri    = trim(parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH), '/');
$parts  = explode('/', $uri);
$action = end($parts); // e.g. vmm-log-complaint
$body   = json_decode(file_get_contents('php://input'), true) ?? [];
$GET    = $_GET;
$METHOD = $_SERVER['REQUEST_METHOD'];


try {
    switch ($action) {

    // ── Reference data ────────────────────────────────────────────────────────
    case 'vmm-sp-products':
        $r = rows($db, "SELECT id, name, shortName FROM {$px}products WHERE is_deleted='No' AND status='1' ORDER BY name");
        ok(['products' => $r]);

    case 'vmm-sp-natures':
        $npF = ensureCols($db, "{$px}natureofproblem", ['type' => 'VARCHAR(255) NULL AFTER name', 'tat_days' => 'INT NULL AFTER type']);
        $r = rows($db, "SELECT id, name, name as nature,
            " . (in_array('type', $npF, true) ? 'type' : "NULL as type") . ",
            " . (in_array('tat_days', $npF, true) ? 'tat_days' : "NULL as tat_days") . "
            FROM {$px}natureofproblem WHERE is_deleted='No' ORDER BY name");
        ok(['natures' => $r]);

    case 'vmm-sp-delay-reasons':
        $r = rows($db, "SELECT id, name, tat FROM {$px}delayreasons WHERE is_deleted='No' ORDER BY name");
        $subTbl = row($db, "SHOW TABLES LIKE '{$px}subdelayreasons'");
        $s = $subTbl ? rows($db, "SELECT id, reasonid, name FROM {$px}subdelayreasons WHERE is_deleted='No' ORDER BY name") : [];
        ok(['reasons' => $r, 'subReasons' => $s]);

    case 'vmm-master-data':
        // One call for all master data in the Settings-page shape
        $npF = ensureCols($db, "{$px}natureofproblem", ['type' => 'VARCHAR(255) NULL AFTER name', 'tat_days' => 'INT NULL AFTER type']);
        $natures = rows($db, "SELECT id, name as nature,
            " . (in_array('type', $npF, true) ? 'type' : "NULL as type") . ",
            " . (in_array('tat_days', $npF, true) ? 'tat_days' : "NULL as tat_days") . "
            FROM {$px}natureofproblem WHERE is_deleted='No' ORDER BY name");
        $complaintTypes = array_values(array_unique(array_filter(array_map(fn($n) => $n['type'], $natures))));
        $dr = rows($db, "SELECT id, name, tat FROM {$px}delayreasons WHERE is_deleted='No' ORDER BY name");
        $sub = rows($db, "SELECT id, reasonid, name FROM {$px}subdelayreasons WHERE is_deleted='No' ORDER BY name");
        $grouped = [];
        foreach ($dr as $main) {
            $subs = array_values(array_filter($sub, fn($x) => (int)$x['reasonid'] === (int)$main['id']));
            if (!$subs) continue;
            $grouped[$main['name']] = array_map(fn($x) => ['label' => $x['name'], 'tat' => $main['tat'] !== null ? (int)$main['tat'] : null], $subs);
        }
        ok(['natures' => $natures, 'complaintTypes' => $complaintTypes, 'delayReasons' => $grouped]);

    case 'vmm-master-save':
        if ($METHOD !== 'POST') fail('POST required');
        $sheet   = e($db, $body['sheet']   ?? '');
        $action  = e($db, $body['action']  ?? 'create');
        $row     = $body['row']            ?? [];
        if (!$sheet || !is_array($row)) fail('sheet and row required');

        if ($sheet === 'Nature') {
            $nature = e($db, $row['nature'] ?? '');
            if (!$nature) fail('nature required');
            $type  = e($db, $row['type']    ?? 'Repair');
            $tat   = (isset($row['tatDays']) && $row['tatDays'] !== '' && $row['tatDays'] !== null) ? (int)$row['tatDays'] : null;
            if ($action === 'delete') {
                q($db, "UPDATE {$px}natureofproblem SET is_deleted='Yes' WHERE name='$nature'");
            } else {
                ensureCols($db, "{$px}natureofproblem", ['type' => 'VARCHAR(255) NULL', 'tat_days' => 'INT NULL']);
                $exists = row($db, "SELECT id FROM {$px}natureofproblem WHERE name='$nature' AND is_deleted='No' LIMIT 1");
                if ($exists) {
                    q($db, "UPDATE {$px}natureofproblem SET type='$type', tat_days=" . ($tat === null ? 'NULL' : $tat) . ", is_deleted='No' WHERE name='$nature'");
                } else {
                    insertAvailable($db, "{$px}natureofproblem", ['name' => $nature, 'type' => $type, 'tat_days' => $tat, 'is_deleted' => 'No', 'status' => 1, 'created' => now_(), 'updated' => now_()]);
                }
            }
            ok();

        } elseif ($sheet === 'ComplaintType') {
            // single-value type lives on the nature row; nothing extra to persist
            ok();

        } elseif ($sheet === 'DelayReason') {
            $main  = e($db, $row['main']  ?? '');
            $label = e($db, $row['label'] ?? '');
            if (!$main) fail('main required');
            $tat = (isset($row['tat']) && $row['tat'] !== '' && $row['tat'] !== null) ? (int)$row['tat'] : null;
            if ($action === 'delete') {
                $dm = row($db, "SELECT id FROM {$px}delayreasons WHERE name='$main' AND is_deleted='No' LIMIT 1");
                if ($dm) {
                    if ($label) {
                        q($db, "UPDATE {$px}subdelayreasons SET is_deleted='Yes' WHERE reasonid={$dm['id']} AND name='$label'");
                    } else {
                        q($db, "UPDATE {$px}subdelayreasons SET is_deleted='Yes' WHERE reasonid={$dm['id']}");
                        q($db, "UPDATE {$px}delayreasons SET is_deleted='Yes' WHERE id={$dm['id']}");
                    }
                }
            } else {
                if (!$label) fail('label required for delay reason');
                $dm = row($db, "SELECT id FROM {$px}delayreasons WHERE name='$main' AND is_deleted='No' LIMIT 1");
                if (!$dm) {
                    insertAvailable($db, "{$px}delayreasons", ['name' => $main, 'tat' => $tat, 'is_deleted' => 'No', 'status' => 1, 'created' => now_(), 'updated' => now_()]);
                    $dm = row($db, "SELECT id FROM {$px}delayreasons WHERE name='$main' AND is_deleted='No' LIMIT 1");
                } else {
                    q($db, "UPDATE {$px}delayreasons SET tat=" . ($tat === null ? 'NULL' : $tat) . ", is_deleted='No' WHERE id={$dm['id']}");
                }
                $sub = row($db, "SELECT id FROM {$px}subdelayreasons WHERE reasonid={$dm['id']} AND name='$label' AND is_deleted='No' LIMIT 1");
                if ($sub) {
                    q($db, "UPDATE {$px}subdelayreasons SET is_deleted='No' WHERE id={$sub['id']}");
                } else {
                    insertAvailable($db, "{$px}subdelayreasons", ['reasonid' => $dm['id'], 'name' => $label, 'is_deleted' => 'No', 'status' => 1, 'created' => now_(), 'updated' => now_()]);
                }
            }
            ok();

        } else {
            fail("Unknown sheet: $sheet", 404);
        }

    case 'vmm-sp-vendors':
        $r = rows($db, "SELECT id, name FROM {$px}vendors WHERE is_deleted='No' AND status='1' ORDER BY name");
        ok(['vendors' => $r]);

    case 'vmm-sp-store':
        $code = e($db, $GET['code'] ?? '');
        if (!$code) fail('code required');
        $r = row($db, "SELECT s.id, s.code, s.name as storename, s.email as storeemail, s.address, s.city,
            s.regionname, s.statename, s.openingdate, s.managername, s.managermobileno,
            s.asmname, s.asmmobileno,
            fm.id as fmid, fm.name as fmname, fm.email as fmemail, fm.mobileno as fmmobileno, fm.city as fmcity
            FROM {$px}stores s
            LEFT JOIN {$px}facilitymanager fm ON fm.id = s.fmid AND fm.is_deleted='No'
            WHERE s.code = '$code' AND s.is_deleted='No' AND s.status='1' LIMIT 1");
        if (!$r) fail('Store not found', 404);
        ok(['store' => $r]);

    case 'vmm-sp-employee':
        $code   = e($db, $GET['code']   ?? '');
        $mobile = e($db, $GET['mobile'] ?? '');
        if ($code) {
            $r = row($db, "SELECT id, code, name, mobileno, email, alternative, designation FROM {$px}employees WHERE code='$code' AND is_deleted='No' AND status='1' LIMIT 1");
        } elseif ($mobile) {
            $r = row($db, "SELECT id, code, name, mobileno, email, alternative, designation FROM {$px}employees WHERE mobileno='$mobile' AND is_deleted='No' AND status='1' LIMIT 1");
        } else { fail('code or mobile required'); }
        if (!$r) fail('Employee not found', 404);
        ok(['employee' => $r]);

    case 'vmm-sp-amc-vendor':
        $store   = e($db, $GET['storeCode'] ?? '');
        $product = e($db, $GET['product']   ?? '');
        // Placeholder — extend if you have an AMC table
        ok(['vendor' => null]);

    case 'vmm-sp-escalation-matrix':
        $product  = e($db, $GET['product']  ?? '');
        $vendorId = e($db, $GET['vendorId'] ?? '');
        $where = "vp.is_deleted='No' AND vp.status='1'";
        if ($product)  $where .= " AND p.name='$product'";
        if ($vendorId) $where .= " AND vp.vendorid='$vendorId'";
        $r = rows($db, "SELECT vp.id, vp.code, p.name as productname, v.name as vendorname, vp.vendorid,
            el.escalationlevel, el.emailids, el.ccemailids, el.tat
            FROM {$px}vendorproducts vp
            JOIN {$px}products p ON p.id=vp.productId AND p.is_deleted='No'
            JOIN {$px}vendors v ON v.id=vp.vendorId AND v.is_deleted='No'
            LEFT JOIN {$px}levelofescalation el ON el.vendorproductid=vp.id AND el.is_deleted='No'
            WHERE $where ORDER BY el.escalationlevel");
        ok(['matrix' => $r]);

    // ── Generate complaint number ──────────────────────────────────────────────
    case 'vmm-generate-comp-no':
        q($db, "CALL generateReferenceNo(@lastid)");
        $r = row($db, "SELECT @lastid as cno");
        $no = date('ymd') . $r['cno'];
        ok(['complaintno' => $no]);

    // ── Log complaint ─────────────────────────────────────────────────────────
    case 'vmm-log-complaint':
        if ($METHOD !== 'POST') fail('POST required');
        $b = $body;

        $complaintno = '';
        // Generate complaint number — increment vmm_referenceno directly
        $refRow = row($db, "SELECT id, lastno FROM {$px}referenceno ORDER BY id DESC LIMIT 1");
        $newRefNo = ($refRow ? (int)$refRow['lastno'] : 0) + 1;
        if ($refRow) {
            q($db, "UPDATE {$px}referenceno SET lastno=$newRefNo WHERE id=" . (int)$refRow['id']);
        } else {
            q($db, "INSERT INTO {$px}referenceno (lastno) VALUES ($newRefNo)");
        }
        $base_no = date('ymd') . $newRefNo;
        $prefix_code = e($db, $b['prefixCode'] ?? '');
        $complaintno = $prefix_code ? $prefix_code . '-' . $base_no : $base_no;

        // Store snapshot
        $storerefid = (int)($b['storerefid'] ?? 0);
        if (!$storerefid) {
            $storeId = (int)($b['storeId'] ?? 0);
            $empId   = (int)($b['empId']   ?? 0);
            $emp   = row($db, "SELECT * FROM {$px}employees WHERE id=$empId AND is_deleted='No' LIMIT 1");
            $store = row($db, "SELECT s.*, fm.name as fmname, fm.email as fmemail, fm.mobileno as fmmobileno, fm.city as fmcity
                FROM {$px}stores s LEFT JOIN {$px}facilitymanager fm ON fm.id=s.fmid WHERE s.id=$storeId AND s.is_deleted='No' LIMIT 1");
            if (!$emp || !$store) fail('Employee or store not found');

            $ins_store = "INSERT INTO {$px}complaintstores
                (empid,empcode,empname,sourceofcomplaints,empmobileno,empemail,emptalternativeno,empdesignation,
                 storeid,storecode,storename,storeemail,storeaddress,storecity,storeregion,statename,openingdate,
                 managername,managermobileno,asmname,asmmobileno,fmid,fmname,fmemail,fmmobileno,fmcity,
                 sourceofctxnid,sourceofcsubject,sourceofcmobileno,uid,created,updated,is_deleted)
                VALUES (
                {$emp['id']},'" . e($db,$emp['code']) . "','" . e($db,$emp['name']) . "','" . e($db,$b['sourceOfComplaints']??'') . "',
                '" . e($db,$b['empContactNo']??$emp['mobileno']) . "','" . e($db,$b['empEmail']??$emp['email']) . "',
                '" . e($db,$emp['alternative']??'') . "','" . e($db,$emp['designation']??'') . "',
                {$store['id']},'" . e($db,$store['code']) . "','" . e($db,$store['name']) . "','" . e($db,$store['email']) . "',
                '" . e($db,$store['address']??'') . "','" . e($db,$store['city']??'') . "','" . e($db,$store['regionname']??'') . "',
                '" . e($db,$store['statename']??'') . "','" . e($db,$store['openingdate']??'') . "',
                '" . e($db,$store['managername']??'') . "','" . e($db,$store['managermobileno']??'') . "',
                '" . e($db,$store['asmname']??'') . "','" . e($db,$store['asmmobileno']??'') . "',
                " . (int)($store['fmid']??0) . ",'" . e($db,$store['fmname']??'') . "','" . e($db,$store['fmemail']??'') . "',
                '" . e($db,$store['fmmobileno']??'') . "','" . e($db,$store['fmcity']??'') . "',
                '" . e($db,$b['txnid']??'') . "','" . e($db,$b['subject']??'') . "','" . e($db,$b['mobileno']??'') . "',
                " . (int)($b['uid']??1) . ",NOW(),NOW(),'No')";
            q($db, $ins_store);
            $storerefid = mysqli_insert_id($db);
        }

        mysqli_begin_transaction($db);
        try {
            $ins_complaint = "INSERT INTO {$px}complaints
                (complaintno,storerefid,productid,productcode,productname,producttype,vendorname,vendorid,
                 productmodel,productlocation,typeofcomplaint,natureofproblem,tat,uid,created,updated,is_deleted)
                VALUES (
                '$complaintno',$storerefid,
                " . (int)($b['productid']??0) . ",'" . e($db,$b['productCode']??'') . "','" . e($db,$b['productname']??'') . "',
                '" . e($db,$b['producttype']??'') . "','" . e($db,$b['vendorName']??'') . "'," . (int)($b['vendorId']??0) . ",
                '" . e($db,$b['productModel']??'') . "','" . e($db,$b['productLocation']??'') . "',
                '" . e($db,$b['typeOfComplaints']??'') . "','" . e($db,$b['natureOfProblem']??'') . "',
                " . (int)($b['tat']??0) . "," . (int)($b['uid']??1) . ",NOW(),NOW(),'No')";
            q($db, $ins_complaint);
            $complaintid = mysqli_insert_id($db);

            $ins_log = "INSERT INTO {$px}complaintlogs
                (complaintid,status,currentstatus,fupdonevia,subject,remarks,uid,created,updated,is_deleted)
                VALUES ($complaintid,'Logged',1,'','','" . e($db,$b['remarks']??'') . "'," . (int)($b['uid']??1) . ",NOW(),NOW(),'No')";
            q($db, $ins_log);

            mysqli_commit($db);
            ok(['complaintno' => $complaintno, 'complaintid' => $complaintid]);
        } catch (Exception $ex) {
            mysqli_rollback($db);
            fail($ex->getMessage(), 500);
        }

    // ── Get complaint ─────────────────────────────────────────────────────────
    case 'vmm-get-complaint':
        $no = e($db, $GET['complaintno'] ?? '');
        if (!$no) fail('complaintno required');
        $r = row($db, "SELECT c.*, s.storename, s.storecode, s.storeemail, s.fmname, s.fmemail, s.fmmobileno,
            s.empname, s.empmobileno, l.status, l.remarks, l.created as log_created
            FROM {$px}complaints c
            JOIN {$px}complaintstores s ON s.id=c.storerefid
            JOIN (SELECT * FROM {$px}complaintlogs l1 WHERE l1.id=(SELECT MAX(id) FROM {$px}complaintlogs l2 WHERE l2.complaintid=l1.complaintid AND l2.is_deleted='No')) l ON l.complaintid=c.id
            WHERE c.is_deleted='No' AND c.complaintno='$no' LIMIT 1");
        if (!$r) fail('Complaint not found', 404);
        ok(['complaint' => $r]);

    // ── Update complaint ──────────────────────────────────────────────────────
    case 'vmm-update-complaint':
        if ($METHOD !== 'POST') fail('POST required');
        $b = $body;
        $complaintId = (int)($b['complaintId'] ?? 0);
        if (!$complaintId) fail('complaintId required');

        $status         = e($db, $b['status']          ?? 'Updated');
        $followupMethod = e($db, $b['followupMethod']   ?? 'Call');
        $txnId          = e($db, $b['txnId']            ?? '');
        $mobileCalled   = e($db, $b['mobileCalled']     ?? '');
        $emailSubject   = e($db, $b['emailSubject']     ?? '');
        $vendorTicketNo = e($db, $b['vendorTicketNo']   ?? '');
        $delayMain      = e($db, $b['delayMain']        ?? '');
        $delaySub       = e($db, $b['delaySub']         ?? '');
        $remarks        = e($db, $b['remarks']          ?? '');
        $newEdc         = e($db, $b['newClosureDate']   ?? '');
        $uid            = (int)($b['uid']               ?? 1);
        $escLevel       = (int)($b['escalationLevel']   ?? 1);

        $ins = "INSERT INTO {$px}complaintlogs
            (complaintid,status,currentstatus,fupdonevia,subject,mobileno,txnid,
             reasonfordelay,subreasonfordelay,remarks,uid,created,updated,is_deleted)
            VALUES ($complaintId,'$status',1,'$followupMethod','$emailSubject',
            '$mobileCalled','$txnId','$delayMain','$delaySub','$remarks',$uid,NOW(),NOW(),'No')";
        q($db, $ins);
        $logid = mysqli_insert_id($db);

        if ($vendorTicketNo) {
            q($db, "UPDATE {$px}vendorescalations SET ticketno='$vendorTicketNo' WHERE id=(SELECT MAX(id) FROM (SELECT id FROM {$px}vendorescalations WHERE complaintid=$complaintId) t)");
        }
        if ($newEdc) {
            q($db, "INSERT INTO {$px}vendorescalations (logid,complaintid,escalationlevel,ticketno,closuredate,uid,created,updated,is_deleted)
                VALUES ($logid,$complaintId,$escLevel,'$vendorTicketNo','$newEdc',$uid,NOW(),NOW(),'No')");
        }
        ok(['complaintId' => $complaintId, 'status' => $status]);

    // ── Escalate complaint ────────────────────────────────────────────────────
    case 'vmm-escalate-complaint':
        if ($METHOD !== 'POST') fail('POST required');
        $b = $body;
        $complaintId    = (int)($b['complaintId']    ?? 0);
        if (!$complaintId) fail('complaintId required');
        $followupMethod = e($db, $b['followupMethod']  ?? 'Call');
        $txnId          = e($db, $b['txnId']           ?? '');
        $mobileCalled   = e($db, $b['mobileCalled']    ?? '');
        $emailSubject   = e($db, $b['emailSubject']    ?? '');
        $vendorTicketNo = e($db, $b['vendorTicketNo']  ?? '');
        $delayMain      = e($db, $b['delayMain']       ?? '');
        $delaySub       = e($db, $b['delaySub']        ?? '');
        $remarks        = e($db, $b['remarks']         ?? '');
        $newEdc         = e($db, $b['newClosureDate']  ?? '');
        $uid            = (int)($b['uid']              ?? 1);
        $escLevel       = (int)($b['escalationLevel']  ?? 1);

        $ins_log = "INSERT INTO {$px}complaintlogs
            (complaintid,status,currentstatus,fupdonevia,subject,mobileno,txnid,
             reasonfordelay,subreasonfordelay,remarks,uid,created,updated,is_deleted)
            VALUES ($complaintId,'Escalated',1,'$followupMethod','$emailSubject',
            '$mobileCalled','$txnId','$delayMain','$delaySub','$remarks',$uid,NOW(),NOW(),'No')";
        q($db, $ins_log);
        $logid = mysqli_insert_id($db);

        q($db, "INSERT INTO {$px}vendorescalations
            (logid,complaintid,escalationlevel,ticketno,closuredate,uid,uuid,created,updated,is_deleted)
            VALUES ($logid,$complaintId,$escLevel,'$vendorTicketNo','$newEdc',$uid,0,NOW(),NOW(),'No')");

        ok(['complaintId' => $complaintId, 'status' => 'Escalated']);

    // ── Close complaint ───────────────────────────────────────────────────────
    case 'vmm-close-complaint':
        if ($METHOD !== 'POST') fail('POST required');
        $b = $body;
        $complaintId   = (int)($b['complaintId']  ?? 0);
        if (!$complaintId) fail('complaintId required');
        $closureStatus  = e($db, $b['closureStatus']  ?? 'Closed');
        $followupMethod = e($db, $b['followupMethod'] ?? 'Call');
        $txnId          = e($db, $b['txnId']          ?? '');
        $mobileCalled   = e($db, $b['mobileCalled']   ?? '');
        $emailSubject   = e($db, $b['emailSubject']   ?? '');
        $vendorTicketNo = e($db, $b['vendorTicketNo'] ?? '');
        $delayMain      = e($db, $b['delayMain']      ?? '');
        $delaySub       = e($db, $b['delaySub']       ?? '');
        $remarks        = e($db, $b['remarks']        ?? '');
        $closureDate    = e($db, $b['closureDate']    ?? '');
        $newEdc         = e($db, $b['newClosureDate'] ?? '');
        $closedBy       = e($db, $b['closedBy']       ?? '');
        $uid            = (int)($b['uid']             ?? 1);
        $escLevel       = (int)($b['escalationLevel'] ?? 1);
        $closureDateVal = $closureDate ? "'$closureDate'" : 'NULL';

        $ins_log = "INSERT INTO {$px}complaintlogs
            (complaintid,status,currentstatus,fupdonevia,subject,mobileno,txnid,
             reasonfordelay,subreasonfordelay,caseclosedby,closureinformdate,
             remarks,uid,created,updated,is_deleted)
            VALUES ($complaintId,'$closureStatus',1,'$followupMethod','$emailSubject',
            '$mobileCalled','$txnId','$delayMain','$delaySub','$closedBy',
            $closureDateVal,'$remarks',$uid,NOW(),NOW(),'No')";
        q($db, $ins_log);
        $logid = mysqli_insert_id($db);

        if ($newEdc) {
            $existingEsc = row($db, "SELECT id FROM {$px}vendorescalations WHERE complaintid=$complaintId AND is_deleted='No' ORDER BY id DESC LIMIT 1");
            if ($existingEsc) {
                q($db, "UPDATE {$px}vendorescalations SET closuredate='$newEdc', escalationlevel=$escLevel, logid=$logid, updated=NOW() WHERE id=" . (int)$existingEsc['id']);
            } else {
                q($db, "INSERT INTO {$px}vendorescalations (logid,complaintid,escalationlevel,ticketno,closuredate,uid,uuid,created,updated,is_deleted) VALUES ($logid,$complaintId,$escLevel,'$vendorTicketNo','$newEdc',$uid,0,NOW(),NOW(),'No')");
            }
        }
        ok(['complaintId' => $complaintId, 'closureStatus' => $closureStatus]);

    // ── Not connected ─────────────────────────────────────────────────────────
    case 'vmm-not-connected':
        if ($METHOD !== 'POST') fail('POST required');
        $b             = $body;
        $complaintId   = (int)($b['complaintId']    ?? 0);
        $uid           = (int)($b['uid']            ?? 1);
        $remarks       = e($db, $b['remarks']       ?? 'Not Connected');
        $suppressEmail = !empty($b['suppressEmail']);
        $newEdc        = e($db, $b['newClosureDate'] ?? '');
        $hoEmail       = e($db, $b['hoEmail']        ?? '');
        if (!$complaintId) fail('complaintId required');

        // Carry forward delay reason from last log entry (don't reset it)
        $prevLog   = row($db, "SELECT reasonfordelay, subreasonfordelay FROM {$px}complaintlogs WHERE complaintid=$complaintId AND is_deleted='No' ORDER BY id DESC LIMIT 1");
        $delayMain = e($db, $prevLog['reasonfordelay']    ?? '');
        $delaySub  = e($db, $prevLog['subreasonfordelay'] ?? '');

        // Log NC action
        q($db, "INSERT INTO {$px}complaintlogs
            (complaintid,status,currentstatus,fupdonevia,reasonfordelay,subreasonfordelay,remarks,uid,created,updated,is_deleted)
            VALUES ($complaintId,'Not Connected',1,'Not Connected','$delayMain','$delaySub','$remarks',$uid,NOW(),NOW(),'No')");

        // Update EDC if provided (auto-dial sets EDC to tomorrow)
        if ($newEdc) {
            $esc = row($db, "SELECT id FROM {$px}vendorescalations WHERE complaintid=$complaintId AND is_deleted='No' ORDER BY id DESC LIMIT 1");
            if ($esc) q($db, "UPDATE {$px}vendorescalations SET closuredate='$newEdc' WHERE id=" . (int)$esc['id']);
        }

        // Fetch store email, FM email and complaint details for the email
        $cdet = row($db, "SELECT c.complaintno, c.productname, s.storename, s.storecode, s.storeemail, s.fmemail
            FROM {$px}complaints c JOIN {$px}complaintstores s ON s.id=c.storerefid
            WHERE c.id=$complaintId LIMIT 1");

        $emailSent = false;
        if (!$suppressEmail && $cdet && !empty($cdet['storeemail'])) {
            // Get app-only token
            $ch = curl_init("https://login.microsoftonline.com/" . GRAPH_TENANT_ID . "/oauth2/v2.0/token");
            curl_setopt_array($ch, [CURLOPT_RETURNTRANSFER=>true, CURLOPT_POST=>true,
                CURLOPT_POSTFIELDS=>http_build_query([
                    'grant_type'=>'client_credentials','client_id'=>GRAPH_CLIENT_ID,
                    'client_secret'=>GRAPH_CLIENT_SECRET,'scope'=>'https://graph.microsoft.com/.default',
                ])]);
            $tok = json_decode(curl_exec($ch), true)['access_token'] ?? null;
            curl_close($ch);

            if ($tok) {
                $toAddr = $cdet['storeemail'];
                $fmAddr = $cdet['fmemail'] ?? '';
                $subj   = "Follow-up: {$cdet['complaintno']} — {$cdet['productname']} ({$cdet['storename']})";
                $html   = "<p>Dear Store Manager,</p>"
                    . "<p>We attempted to follow up on complaint <strong>{$cdet['complaintno']}</strong> "
                    . "regarding <strong>{$cdet['productname']}</strong> at <strong>{$cdet['storename']} ({$cdet['storecode']})</strong>.</p>"
                    . "<p>We were unable to reach the store at this time. "
                    . "Kindly ensure the issue is attended to at the earliest and share the latest status with us.</p>"
                    . "<p>Regards,<br/>VMM Helpdesk</p>";
                $mkR = fn($e) => [['emailAddress'=>['address'=>trim($e)]]];
                $ccList = [];
                if ($fmAddr) $ccList[] = ['emailAddress'=>['address'=>trim($fmAddr)]];
                if ($hoEmail) $ccList[] = ['emailAddress'=>['address'=>trim($hoEmail)]];
                $payload = ['message'=>[
                    'subject'=>$subj,'body'=>['contentType'=>'HTML','content'=>$html],
                    'toRecipients'=>$mkR($toAddr),
                    'ccRecipients'=>$ccList,
                ],'saveToSentItems'=>true];
                $mailbox = urlencode(GRAPH_MAILBOX);
                $ch2 = curl_init("https://graph.microsoft.com/v1.0/users/$mailbox/sendMail");
                curl_setopt_array($ch2, [CURLOPT_RETURNTRANSFER=>true,CURLOPT_POST=>true,
                    CURLOPT_POSTFIELDS=>json_encode($payload),
                    CURLOPT_HTTPHEADER=>["Authorization: Bearer $tok","Content-Type: application/json"]]);
                curl_exec($ch2);
                $sendCode = curl_getinfo($ch2, CURLINFO_HTTP_CODE);
                curl_close($ch2);
                $emailSent = ($sendCode < 300);

                // Log email event to case history
                $ccLog = implode(', ', array_filter([$fmAddr, $hoEmail]));
                $emailNote = e($db, $emailSent
                    ? "Not Connected email sent to $toAddr" . ($ccLog ? " (CC: $ccLog)" : '')
                    : "Not Connected email failed to send");
                q($db, "INSERT INTO {$px}complaintlogs
                    (complaintid,status,currentstatus,fupdonevia,remarks,uid,created,updated,is_deleted)
                    VALUES ($complaintId,'Not Connected',1,'Email Sent','$emailNote',$uid,NOW(),NOW(),'No')");
            }
        }

        ok(['success' => true, 'emailSent' => $emailSent]);

    // ── Update EDC ────────────────────────────────────────────────────────────
    case 'vmm-update-edc':
        if ($METHOD !== 'POST') fail('POST required');
        $b = $body;
        $complaintId = (int)($b['complaintId'] ?? 0);
        $newEdc      = e($db, $b['newClosureDate']  ?? '');
        $delayMain   = e($db, $b['delayMain']       ?? '');
        $delaySub    = e($db, $b['delaySub']        ?? '');
        $remarks     = e($db, $b['remarks']         ?? '');
        $uid         = (int)($b['uid']              ?? 1);
        if (!$complaintId || !$newEdc) fail('complaintId and newClosureDate required');

        // Update EDC on latest escalation record
        $esc = row($db, "SELECT id FROM {$px}vendorescalations WHERE complaintid=$complaintId AND is_deleted='No' ORDER BY id DESC LIMIT 1");
        if ($esc) {
            q($db, "UPDATE {$px}vendorescalations SET closuredate='$newEdc' WHERE id=" . (int)$esc['id']);
        }

        // Log the EDC update to complaint history
        q($db, "INSERT INTO {$px}complaintlogs
            (complaintid,status,currentstatus,fupdonevia,reasonfordelay,subreasonfordelay,remarks,uid,created,updated,is_deleted)
            VALUES ($complaintId,'Updated',1,'EDC Followup','$delayMain','$delaySub','EDC updated to $newEdc" . ($remarks ? " — $remarks" : "") . "',$uid,NOW(),NOW(),'No')");

        ok(['complaintId' => $complaintId, 'newEdc' => $newEdc]);

    // ── Send email via app-only Graph API (no user token needed) ─────────────
    case 'vmm-send-email':
        if ($METHOD !== 'POST') fail('POST required');
        $b       = $body;
        $to      = array_filter((array)($b['to']      ?? []));
        $cc      = array_filter((array)($b['cc']      ?? []));
        $subject = trim($b['subject'] ?? '');
        $html    = trim($b['html']    ?? '');
        if (!$subject || !$html || empty($to)) fail('to, subject and html required');

        // 1. Get app-only token
        $ch = curl_init("https://login.microsoftonline.com/" . GRAPH_TENANT_ID . "/oauth2/v2.0/token");
        curl_setopt_array($ch, [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_POST           => true,
            CURLOPT_POSTFIELDS     => http_build_query([
                'grant_type'    => 'client_credentials',
                'client_id'     => GRAPH_CLIENT_ID,
                'client_secret' => GRAPH_CLIENT_SECRET,
                'scope'         => 'https://graph.microsoft.com/.default',
            ]),
        ]);
        $tokenData = json_decode(curl_exec($ch), true);
        curl_close($ch);
        $token = $tokenData['access_token'] ?? null;
        if (!$token) fail('Failed to obtain mail token');

        // 2. Send via Graph API
        $mkRecip = fn($emails) => array_values(array_map(fn($e) => ['emailAddress' => ['address' => trim($e)]], $emails));
        $payload = json_encode([
            'message' => [
                'subject'       => $subject,
                'body'          => ['contentType' => 'HTML', 'content' => $html],
                'toRecipients'  => $mkRecip($to),
                'ccRecipients'  => $mkRecip($cc),
            ],
            'saveToSentItems' => true,
        ]);
        $mailbox = urlencode(GRAPH_MAILBOX);
        $ch2 = curl_init("https://graph.microsoft.com/v1.0/users/$mailbox/sendMail");
        curl_setopt_array($ch2, [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_POST           => true,
            CURLOPT_POSTFIELDS     => $payload,
            CURLOPT_HTTPHEADER     => ["Authorization: Bearer $token", "Content-Type: application/json"],
        ]);
        $sendBody = curl_exec($ch2);
        $sendCode = curl_getinfo($ch2, CURLINFO_HTTP_CODE);
        curl_close($ch2);
        if ($sendCode >= 300) {
            $err = json_decode($sendBody, true)['error']['message'] ?? "HTTP $sendCode";
            fail($err);
        }
        ok(['sent' => true]);

    // ── Follow-up complaints list ──────────────────────────────────────────────
    case 'vmm-followup-complaints':
        $r = rows($db, "SELECT c.id, c.complaintno, c.productname, c.vendorname, c.created,
            s.storecode, s.storename, s.storeemail, s.fmname, s.fmemail, s.empname, s.empmobileno,
            l.status, l.remarks, l.created as last_updated,
            esc.closuredate as edc, esc.ticketno, esc.escalationlevel,
            DATEDIFF(CURDATE(), esc.closuredate) as days_overdue,
            (SELECT COUNT(*) FROM {$px}complaintlogs nc WHERE nc.complaintid=c.id AND nc.fupdonevia='Not Connected' AND nc.is_deleted='No') as nc_count
            FROM {$px}complaints c
            JOIN {$px}complaintstores s ON s.id=c.storerefid AND s.is_deleted='No'
            JOIN (SELECT * FROM {$px}complaintlogs l1 WHERE l1.id=(SELECT MAX(id) FROM {$px}complaintlogs l2 WHERE l2.complaintid=l1.complaintid AND l2.is_deleted='No')) l ON l.complaintid=c.id
            LEFT JOIN (SELECT * FROM {$px}vendorescalations e1 WHERE e1.id=(SELECT MAX(id) FROM {$px}vendorescalations e2 WHERE e2.complaintid=e1.complaintid AND e2.is_deleted='No')) esc ON esc.complaintid=c.id
            WHERE c.is_deleted='No' AND l.status NOT IN ('Closed')
            ORDER BY c.id DESC");
        ok(['complaints' => $r]);

    // ── Store-level pending followups (same store, all open) ──────────────────
    case 'vmm-store-followups':
        $sfCode = e($db, $GET['storecode'] ?? '');
        if (!$sfCode) fail('storecode required');
        $sfRows = rows($db, "SELECT c.id, c.complaintno, c.productname, c.vendorname,
            l.status as current_status,
            esc.closuredate as edc,
            DATEDIFF(CURDATE(), esc.closuredate) as days_overdue,
            (SELECT COUNT(*) FROM {$px}complaintlogs nc WHERE nc.complaintid=c.id AND nc.fupdonevia='Not Connected' AND nc.is_deleted='No') as nc_count
            FROM {$px}complaints c
            JOIN {$px}complaintstores s ON s.id=c.storerefid AND s.is_deleted='No'
            JOIN (SELECT * FROM {$px}complaintlogs l1 WHERE l1.id=(SELECT MAX(id) FROM {$px}complaintlogs l2 WHERE l2.complaintid=l1.complaintid AND l2.is_deleted='No')) l ON l.complaintid=c.id
            LEFT JOIN (SELECT * FROM {$px}vendorescalations e1 WHERE e1.id=(SELECT MAX(id) FROM {$px}vendorescalations e2 WHERE e2.complaintid=e1.complaintid AND e2.is_deleted='No')) esc ON esc.complaintid=c.id
            WHERE s.storecode='$sfCode' AND c.is_deleted='No' AND l.status NOT IN ('Closed')
            AND esc.closuredate <= CURDATE()
            ORDER BY esc.closuredate ASC");
        ok(['complaints' => $sfRows]);

    // ── Follow-up users list (for assignment dropdown) ────────────────────────
    case 'vmm-followup-users':
        $fuAll = rows($db, "SELECT * FROM {$px}users
            WHERE (is_deleted IS NULL OR is_deleted != 'Yes')
            AND (status IS NULL OR CAST(status AS CHAR) != '0')
            AND (email LIKE '%@openmind.in' OR email LIKE '%@openmindserviceslimited.in')
            AND email NOT IN ('inder@openmind.in','amandeep@openmind.in','intern@openmind.in')
            ORDER BY name");
        $fuUsers = array_values(array_filter(array_map(function($u) {
            $nm = trim($u['name'] ?? $u['username'] ?? '');
            if (!$nm) return null;
            return ['id' => $u['id'], 'name' => $nm, 'email' => $u['email'] ?? ''];
        }, $fuAll)));
        ok(['users' => $fuUsers]);

    // ── Assign follow-up complaints to users ──────────────────────────────────
    case 'vmm-assign-followup':
        if ($METHOD !== 'POST') fail('POST required');
        $asgns = $body['assignments'] ?? [];
        $asgBy = (int)($body['assigned_by'] ?? 0);
        $db->query("CREATE TABLE IF NOT EXISTS {$px}followup_assignments (
            id INT AUTO_INCREMENT PRIMARY KEY,
            complaint_id INT NOT NULL,
            assigned_to  INT NOT NULL,
            assigned_by  INT NOT NULL,
            assigned_at  DATETIME DEFAULT NOW(),
            UNIQUE KEY uq_cmp (complaint_id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");
        $aCount = 0;
        foreach ($asgns as $a) {
            $cid = (int)($a['complaint_id'] ?? 0);
            $uid = (int)($a['user_id'] ?? 0);
            if (!$cid || !$uid) continue;
            $db->query("INSERT INTO {$px}followup_assignments (complaint_id, assigned_to, assigned_by)
                VALUES ($cid, $uid, $asgBy)
                ON DUPLICATE KEY UPDATE assigned_to=$uid, assigned_by=$asgBy, assigned_at=NOW()");
            $aCount++;
        }
        ok(['assigned' => $aCount]);

    // ── My assigned follow-ups ─────────────────────────────────────────────────
    case 'vmm-my-followups':
        $mfUid = (int)($GET['user_id'] ?? 0);
        if (!$mfUid) fail('user_id required');
        $tExists = row($db, "SELECT COUNT(*) as n FROM information_schema.tables WHERE table_schema=DATABASE() AND table_name='{$px}followup_assignments'");
        if (!($tExists['n'] ?? 0)) { ok(['complaints' => []]); break; }
        $mfRows = rows($db, "SELECT c.id, c.complaintno, c.productname, c.vendorname, c.created,
            s.storecode, s.storename, s.storeemail, s.fmname, s.fmemail, s.empname, s.empmobileno,
            l.status, l.remarks, l.created as last_updated,
            esc.closuredate as edc, esc.ticketno, esc.escalationlevel,
            DATEDIFF(CURDATE(), esc.closuredate) as days_overdue,
            (SELECT COUNT(*) FROM {$px}complaintlogs nc WHERE nc.complaintid=c.id AND nc.fupdonevia='Not Connected' AND nc.is_deleted='No') as nc_count
            FROM {$px}complaints c
            JOIN {$px}complaintstores s ON s.id=c.storerefid AND s.is_deleted='No'
            JOIN (SELECT * FROM {$px}complaintlogs l1 WHERE l1.id=(SELECT MAX(id) FROM {$px}complaintlogs l2 WHERE l2.complaintid=l1.complaintid AND l2.is_deleted='No')) l ON l.complaintid=c.id
            LEFT JOIN (SELECT * FROM {$px}vendorescalations e1 WHERE e1.id=(SELECT MAX(id) FROM {$px}vendorescalations e2 WHERE e2.complaintid=e1.complaintid AND e2.is_deleted='No')) esc ON esc.complaintid=c.id
            JOIN {$px}followup_assignments fa ON fa.complaint_id=c.id AND fa.assigned_to=$mfUid
            WHERE c.is_deleted='No' AND l.status NOT IN ('Closed')
            ORDER BY esc.closuredate ASC");
        ok(['complaints' => $mfRows]);

    // ── Bulk Not Connected (all pending complaints at a store in one action) ───
    case 'vmm-bulk-not-connected':
        if ($METHOD !== 'POST') fail('POST required');
        $bnc    = $body;
        $bncIds = array_values(array_filter(array_map('intval', (array)($bnc['complaintIds'] ?? []))));
        if (!$bncIds) fail('complaintIds required');
        $bncRem  = e($db, $bnc['remarks']   ?? 'Called - Not Connected');
        $bncUid  = (int)($bnc['uid']        ?? 1);
        $bncMain = e($db, $bnc['delayMain'] ?? '');
        $bncSub  = e($db, $bnc['delaySub']  ?? '');

        foreach ($bncIds as $bncId) {
            q($db, "INSERT INTO {$px}complaintlogs
                (complaintid,status,currentstatus,fupdonevia,reasonfordelay,subreasonfordelay,remarks,uid,created,updated,is_deleted)
                VALUES ($bncId,'Not Connected',1,'Not Connected','$bncMain','$bncSub','$bncRem',$bncUid,NOW(),NOW(),'No')");
        }

        // Fetch store email from first complaint
        $bncFirst = $bncIds[0];
        $bncStore = row($db, "SELECT c.complaintno, s.storename, s.storecode, s.storeemail, s.fmemail
            FROM {$px}complaints c JOIN {$px}complaintstores s ON s.id=c.storerefid
            WHERE c.id=$bncFirst LIMIT 1");
        $bncEmailSent = false;

        if ($bncStore && !empty($bncStore['storeemail'])) {
            // Build complaint table rows for email
            $bncIdList = implode(',', $bncIds);
            $bncCRows = rows($db, "SELECT c.complaintno, c.productname,
                esc.closuredate as edc, DATEDIFF(CURDATE(), esc.closuredate) as days_overdue
                FROM {$px}complaints c
                LEFT JOIN (SELECT * FROM {$px}vendorescalations e1 WHERE e1.id=(SELECT MAX(id) FROM {$px}vendorescalations e2 WHERE e2.complaintid=e1.complaintid AND e2.is_deleted='No')) esc ON esc.complaintid=c.id
                WHERE c.id IN ($bncIdList) ORDER BY esc.closuredate ASC");

            $bncTableRows = '';
            foreach ($bncCRows as $br) {
                $ov = (int)$br['days_overdue'];
                $ovText = $ov > 0 ? "$ov days overdue" : 'Due today';
                $ovColor = $ov > 0 ? '#dc2626' : '#374151';
                $edcFmt = $br['edc'] ? date('d M Y', strtotime($br['edc'])) : '—';
                $bncTableRows .= "<tr><td style='padding:6px 10px;border-bottom:1px solid #e2e8f0;font-family:monospace'>" . htmlspecialchars($br['complaintno']) . "</td>"
                    . "<td style='padding:6px 10px;border-bottom:1px solid #e2e8f0'>" . htmlspecialchars($br['productname']) . "</td>"
                    . "<td style='padding:6px 10px;border-bottom:1px solid #e2e8f0'>$edcFmt</td>"
                    . "<td style='padding:6px 10px;border-bottom:1px solid #e2e8f0;color:$ovColor'>$ovText</td></tr>";
            }

            $bncSN = htmlspecialchars($bncStore['storename']);
            $bncSC = htmlspecialchars($bncStore['storecode']);
            $bncCnt = count($bncIds);
            $bncHtml = "<p>Dear Store Manager,</p>"
                . "<p>We attempted to follow up with <strong>$bncSN ($bncSC)</strong> but were unable to connect at this time.</p>"
                . "<p>The following <strong>$bncCnt complaint(s)</strong> require your attention:</p>"
                . "<table style='border-collapse:collapse;width:100%;font-size:13px'>"
                . "<thead><tr style='background:#f1f5f9'>"
                . "<th style='padding:7px 10px;text-align:left;font-size:11px;text-transform:uppercase;letter-spacing:.04em'>Complaint No</th>"
                . "<th style='padding:7px 10px;text-align:left;font-size:11px;text-transform:uppercase;letter-spacing:.04em'>Product</th>"
                . "<th style='padding:7px 10px;text-align:left;font-size:11px;text-transform:uppercase;letter-spacing:.04em'>EDC</th>"
                . "<th style='padding:7px 10px;text-align:left;font-size:11px;text-transform:uppercase;letter-spacing:.04em'>Status</th>"
                . "</tr></thead><tbody>$bncTableRows</tbody></table>"
                . "<p style='margin-top:16px'>Kindly ensure these issues are attended to at the earliest and share the latest status with us.</p>"
                . "<p>Regards,<br/>VMM Helpdesk</p>";
            $bncSubj = "Follow-up Required: $bncCnt Open Complaint(s) at $bncSN ($bncSC)";

            // Get Graph token
            $bncCh = curl_init("https://login.microsoftonline.com/" . GRAPH_TENANT_ID . "/oauth2/v2.0/token");
            curl_setopt_array($bncCh, [CURLOPT_RETURNTRANSFER=>true, CURLOPT_POST=>true,
                CURLOPT_POSTFIELDS=>http_build_query(['grant_type'=>'client_credentials','client_id'=>GRAPH_CLIENT_ID,
                    'client_secret'=>GRAPH_CLIENT_SECRET,'scope'=>'https://graph.microsoft.com/.default'])]);
            $bncTok = json_decode(curl_exec($bncCh), true)['access_token'] ?? null;
            curl_close($bncCh);

            if ($bncTok) {
                $bncMkR = fn($e) => [['emailAddress'=>['address'=>trim($e)]]];
                $bncTo = $bncStore['storeemail'];
                $bncCC = $bncStore['fmemail'] ?? '';
                $bncPayload = ['message'=>['subject'=>$bncSubj,'body'=>['contentType'=>'HTML','content'=>$bncHtml],
                    'toRecipients'=>$bncMkR($bncTo),'ccRecipients'=>$bncCC ? $bncMkR($bncCC) : []],'saveToSentItems'=>true];
                $bncCh2 = curl_init("https://graph.microsoft.com/v1.0/users/" . urlencode(GRAPH_MAILBOX) . "/sendMail");
                curl_setopt_array($bncCh2, [CURLOPT_RETURNTRANSFER=>true,CURLOPT_POST=>true,
                    CURLOPT_POSTFIELDS=>json_encode($bncPayload),
                    CURLOPT_HTTPHEADER=>["Authorization: Bearer $bncTok","Content-Type: application/json"]]);
                curl_exec($bncCh2);
                $bncEmailSent = (curl_getinfo($bncCh2, CURLINFO_HTTP_CODE) < 300);
                curl_close($bncCh2);

                if ($bncEmailSent) {
                    $bncNote = e($db, "Bulk NC email sent to $bncTo" . ($bncCC ? " (CC: $bncCC)" : '') . " — $bncCnt complaints");
                    foreach ($bncIds as $bncId) {
                        q($db, "INSERT INTO {$px}complaintlogs
                            (complaintid,status,currentstatus,fupdonevia,remarks,uid,created,updated,is_deleted)
                            VALUES ($bncId,'Not Connected',1,'Email Sent','$bncNote',$bncUid,NOW(),NOW(),'No')");
                    }
                }
            }
        }
        ok(['success'=>true,'logged'=>count($bncIds),'emailSent'=>$bncEmailSent]);

    // ── Search complaints ─────────────────────────────────────────────────────
    case 'vmm-search-complaints':
        $q_text   = e($db, $GET['q']       ?? '');
        $from     = e($db, $GET['from']    ?? '');
        $to       = e($db, $GET['to']      ?? '');
        $status   = e($db, $GET['status']  ?? '');
        $edc      = e($db, $GET['edc']     ?? '');
        $where = "c.is_deleted='No'";
        if ($q_text) $where .= " AND (c.complaintno LIKE '%$q_text%' OR s.storecode LIKE '%$q_text%' OR s.storename LIKE '%$q_text%' OR c.productname LIKE '%$q_text%' OR esc.ticketno LIKE '%$q_text%')";
        if ($from)   $where .= " AND c.created >= '$from 00:00:00'";
        if ($to)     $where .= " AND c.created <= '$to 23:59:59'";
        if ($status) $where .= " AND l.status='$status'";
        if ($edc)    $where .= " AND esc.closuredate <= '$edc 23:59:59'";
        $r = rows($db, "SELECT c.id, c.complaintno, c.productname, c.vendorname, c.created,
            s.storecode, s.storename, s.fmname,
            l.status, l.remarks,
            esc.closuredate as edc, esc.ticketno,
            DATEDIFF(NOW(), c.created) as aging
            FROM {$px}complaints c
            JOIN {$px}complaintstores s ON s.id=c.storerefid AND s.is_deleted='No'
            JOIN (SELECT * FROM {$px}complaintlogs l1 WHERE l1.id=(SELECT MAX(id) FROM {$px}complaintlogs l2 WHERE l2.complaintid=l1.complaintid AND l2.is_deleted='No')) l ON l.complaintid=c.id
            LEFT JOIN (SELECT * FROM {$px}vendorescalations e1 WHERE e1.id=(SELECT MAX(id) FROM {$px}vendorescalations e2 WHERE e2.complaintid=e1.complaintid AND e2.is_deleted='No')) esc ON esc.complaintid=c.id
            WHERE $where ORDER BY c.id DESC LIMIT 500");
        ok(['complaints' => $r]);

    // ── Complaint detail (full) ────────────────────────────────────────────────
    case 'vmm-complaint-detail':
        $no = e($db, $GET['no'] ?? '');
        if (!$no) fail('no required');
        $c = row($db, "SELECT c.*, s.storename, s.storecode, s.storeemail, s.fmname, s.fmemail, s.fmmobileno,
            s.empname, s.empmobileno, s.managername, s.managermobileno, s.storeaddress, s.storecity, s.fmcity,
            s.asmname, s.asmmobileno, s.statename
            FROM {$px}complaints c JOIN {$px}complaintstores s ON s.id=c.storerefid
            WHERE c.is_deleted='No' AND (c.complaintno='$no' OR c.id='$no') LIMIT 1");
        if (!$c) fail('Not found', 404);
        $logs = rows($db, "SELECT l.*, u.name as agentname, esc.ticketno, esc.escalationlevel, esc.closuredate
            FROM {$px}complaintlogs l
            LEFT JOIN {$px}users u ON u.id=l.uid AND u.is_deleted='No'
            LEFT JOIN {$px}vendorescalations esc ON esc.logid=l.id AND esc.is_deleted='No'
            WHERE l.is_deleted='No' AND l.complaintid=" . (int)$c['id'] . " ORDER BY l.id");
        ok(['complaint' => $c, 'logs' => $logs]);

    // ── Recent complaints for a store ──────────────────────────────────────────
    case 'vmm-recent-complaints':
        $code = e($db, $GET['storeCode'] ?? '');
        if (!$code) fail('storeCode required');
        $r = rows($db, "SELECT c.id, c.complaintno, c.productname, c.vendorname, c.created, l.status
            FROM {$px}complaints c
            JOIN {$px}complaintstores s ON s.id=c.storerefid AND s.storecode='$code' AND s.is_deleted='No'
            JOIN (SELECT * FROM {$px}complaintlogs l1 WHERE l1.id=(SELECT MAX(id) FROM {$px}complaintlogs l2 WHERE l2.complaintid=l1.complaintid AND l2.is_deleted='No')) l ON l.complaintid=c.id
            WHERE c.is_deleted='No' AND l.status NOT IN ('Closed')
            ORDER BY c.id DESC LIMIT 10");
        ok(['complaints' => $r]);

    // ── Dashboard stats ───────────────────────────────────────────────────────
    case 'vmm-dashboard-stats':
        $from = e($db, $GET['from'] ?? date('Y-m-01'));
        $to   = e($db, $GET['to']   ?? date('Y-m-d'));
        $logged   = row($db, "SELECT COUNT(*) as cnt FROM {$px}complaints c WHERE c.is_deleted='No' AND DATE(c.created) BETWEEN '$from' AND '$to'");
        $open     = row($db, "SELECT COUNT(*) as cnt FROM {$px}complaints c JOIN (SELECT * FROM {$px}complaintlogs l1 WHERE l1.id=(SELECT MAX(id) FROM {$px}complaintlogs l2 WHERE l2.complaintid=l1.complaintid AND l2.is_deleted='No')) l ON l.complaintid=c.id WHERE c.is_deleted='No' AND l.status NOT IN ('Closed')");
        $closed   = row($db, "SELECT COUNT(*) as cnt FROM {$px}complaints c JOIN (SELECT * FROM {$px}complaintlogs l1 WHERE l1.id=(SELECT MAX(id) FROM {$px}complaintlogs l2 WHERE l2.complaintid=l1.complaintid AND l2.is_deleted='No')) l ON l.complaintid=c.id WHERE c.is_deleted='No' AND l.status='Closed' AND DATE(l.created) BETWEEN '$from' AND '$to'");
        $escalated = row($db, "SELECT COUNT(*) as cnt FROM {$px}complaints c JOIN (SELECT * FROM {$px}complaintlogs l1 WHERE l1.id=(SELECT MAX(id) FROM {$px}complaintlogs l2 WHERE l2.complaintid=l1.complaintid AND l2.is_deleted='No')) l ON l.complaintid=c.id WHERE c.is_deleted='No' AND l.status='Escalated'");
        ok([
            'logged'    => (int)$logged['cnt'],
            'open'      => (int)$open['cnt'],
            'closed'    => (int)$closed['cnt'],
            'escalated' => (int)$escalated['cnt'],
        ]);

    // ── User role ─────────────────────────────────────────────────────────────
    case 'vmm-user-role':
        $email = e($db, $GET['email'] ?? '');
        if (!$email) fail('email required');
        $u = row($db, "SELECT * FROM {$px}users WHERE email='$email' LIMIT 1");
        if (!$u) fail('User not found', 404);
        if (($u['is_deleted'] ?? 'No') === 'Yes') fail('User not found', 404);
        if (isset($u['status']) && (string)$u['status'] === '0') fail('User not found', 404);
        $urole = $u['role'] ?? $u['user_type'] ?? $u['type'] ?? 'agent';
        ok(['found' => true, 'user' => ['id' => $u['id'], 'name' => $u['name'] ?? $u['username'] ?? $email, 'email' => $u['email'] ?? $email, 'role' => $urole, 'type' => $urole], 'role' => $urole]);

    // ── SparkTG inbound ───────────────────────────────────────────────────────
    case 'vmm-sparktg-inbound':
        $mobile = e($db, $GET['mobile'] ?? '');
        if (!$mobile) fail('mobile required');
        $emp = row($db, "SELECT id, code, name, mobileno, email, designation FROM {$px}employees WHERE mobileno='$mobile' AND is_deleted='No' AND status='1' LIMIT 1");
        $ibStore = null; $ibOpen = []; $ibHist = [];
        if ($emp) {
            $ibStore = row($db, "SELECT s.id, s.code AS storeCode, s.name AS storeName,
                s.managername AS smName, s.managermobileno AS managerName
                FROM {$px}stores s
                JOIN {$px}complaintstores cs ON cs.storeid=s.id AND cs.empid={$emp['id']}
                WHERE s.is_deleted='No' ORDER BY cs.id DESC LIMIT 1");
            if ($ibStore) {
                $ibSC = e($db, $ibStore['storeCode']);
                $ibOpen = rows($db, "SELECT c.id, c.complaintno, c.productname, l.status as currentStatus
                    FROM {$px}complaints c
                    JOIN {$px}complaintstores s ON s.id=c.storerefid
                    JOIN (SELECT * FROM {$px}complaintlogs l1 WHERE l1.id=(SELECT MAX(id) FROM {$px}complaintlogs l2 WHERE l2.complaintid=l1.complaintid AND l2.is_deleted='No')) l ON l.complaintid=c.id
                    WHERE s.storecode='$ibSC' AND c.is_deleted='No' AND l.status NOT IN ('Closed')
                    ORDER BY c.id DESC LIMIT 15");
                $ibHist = rows($db, "SELECT c.id, c.complaintno, c.productname, l.status as currentStatus, l.created as closedAt
                    FROM {$px}complaints c
                    JOIN {$px}complaintstores s ON s.id=c.storerefid
                    JOIN (SELECT * FROM {$px}complaintlogs l1 WHERE l1.id=(SELECT MAX(id) FROM {$px}complaintlogs l2 WHERE l2.complaintid=l1.complaintid AND l2.is_deleted='No')) l ON l.complaintid=c.id
                    WHERE s.storecode='$ibSC' AND c.is_deleted='No' AND l.status IN ('Closed')
                    AND c.created >= DATE_SUB(NOW(), INTERVAL 90 DAY)
                    ORDER BY c.id DESC LIMIT 10");
            }
        }
        ok(['found' => !!$emp, 'employee' => $emp, 'store' => $ibStore,
            'openCount' => count($ibOpen), 'complaints' => $ibOpen, 'historical' => $ibHist]);

    // ── Client data feed (Vishal Wholesale) ──────────────────────────────────
    case 'vmm-complaints-feed':
        // Auth — pass header: X-API-Key: <value from dbconfig.php VISHAL_API_KEY>
        $apiKey = $_SERVER['HTTP_X_API_KEY'] ?? $GET['key'] ?? '';
        if ($apiKey !== VISHAL_API_KEY) {
            http_response_code(401);
            echo json_encode(['success'=>false,'error'=>'Unauthorized']);
            exit;
        }

        // Date param — defaults to yesterday
        $feedDate = e($db, $GET['date'] ?? date('Y-m-d', strtotime('-1 day')));

        $rows = rows($db, "
            SELECT
                c.complaintno                                            AS 'Complaint No',
                DATE_FORMAT(c.created, '%d-%m-%Y %H:%i:%s')             AS 'Complaint Date',
                cs.empcode                                               AS 'Employee Code',
                cs.empname                                               AS 'Employee Name',
                cs.empmobileno                                           AS 'Employee Mobile No',
                cs.empdesignation                                        AS 'Employee Designation',
                cs.storecode                                             AS 'Store Code',
                cs.storename                                             AS 'Store Name',
                cs.storeregion                                           AS 'Store Region',
                c.productname                                            AS 'Product Name',
                c.producttype                                            AS 'Product Type',
                c.vendorname                                             AS 'Product Vendor',
                cs.fmname                                                AS 'FM Name',
                c.natureofproblem                                        AS 'Nature of Problem',
                first_log.remarks                                        AS 'First Remarks',
                last_log.remarks                                         AS 'Last Remarks',
                c.tat                                                    AS 'TAT',
                GREATEST(0, DATEDIFF(NOW(), c.created) - c.tat)         AS 'Over Due TAT',
                IFNULL(delay_log.reasonfordelay, '')                     AS 'Last Delay Reason',
                IFNULL(delay_log.subreasonfordelay, '')                  AS 'Last Sub Reason for Delay',
                IFNULL(delay_log.reasonfordelay, '')                     AS 'Reason for Delay',
                last_log.status                                          AS 'Current Status',
                DATE_FORMAT(last_log.created, '%d-%m-%Y %H:%i:%s')      AS 'Last Updated Datetime'
            FROM {$px}complaints c
            JOIN {$px}complaintstores cs ON cs.id = c.storerefid AND cs.is_deleted = 'No'
            JOIN (
                SELECT l1.complaintid, l1.remarks, l1.status, l1.created
                FROM {$px}complaintlogs l1
                WHERE l1.is_deleted = 'No'
                  AND l1.id = (SELECT MAX(l2.id) FROM {$px}complaintlogs l2 WHERE l2.complaintid = l1.complaintid AND l2.is_deleted = 'No')
            ) last_log ON last_log.complaintid = c.id
            JOIN (
                SELECT l1.complaintid, l1.remarks
                FROM {$px}complaintlogs l1
                WHERE l1.is_deleted = 'No'
                  AND l1.id = (SELECT MIN(l2.id) FROM {$px}complaintlogs l2 WHERE l2.complaintid = l1.complaintid AND l2.is_deleted = 'No')
            ) first_log ON first_log.complaintid = c.id
            LEFT JOIN (
                SELECT l1.complaintid, l1.reasonfordelay, l1.subreasonfordelay
                FROM {$px}complaintlogs l1
                WHERE l1.is_deleted = 'No' AND l1.reasonfordelay != ''
                  AND l1.id = (SELECT MAX(l2.id) FROM {$px}complaintlogs l2 WHERE l2.complaintid = l1.complaintid AND l2.is_deleted = 'No' AND l2.reasonfordelay != '')
            ) delay_log ON delay_log.complaintid = c.id
            WHERE c.is_deleted = 'No'
              AND (
                DATE(c.created) = '$feedDate'
                OR c.id IN (SELECT complaintid FROM {$px}complaintlogs WHERE is_deleted='No' AND DATE(created) = '$feedDate')
              )
            ORDER BY c.created ASC
        ");

        $fmt = $GET['format'] ?? 'json';
        if ($fmt === 'csv') {
            header('Content-Type: text/csv; charset=utf-8');
            header('Content-Disposition: attachment; filename="vmm-complaints-' . $feedDate . '.csv"');
            if (!empty($rows)) {
                echo implode(',', array_map(fn($k) => '"' . $k . '"', array_keys($rows[0]))) . "\n";
                foreach ($rows as $row_) {
                    echo implode(',', array_map(fn($v) => '"' . str_replace('"', '""', $v ?? '') . '"', $row_)) . "\n";
                }
            }
            exit;
        }

        ok(['date' => $feedDate, 'count' => count($rows), 'complaints' => $rows]);

    // ── AI polish (passthrough to n8n) ────────────────────────────────────────
    case 'vmm-ai-polish':
        // Keep this in n8n (OpenAI dependency) — return as-is
        $text = $body['text'] ?? '';
        ok(['polished' => $text]);

    default:
        fail("Unknown action: $action", 404);
    }

} catch (Exception $ex) {
    fail($ex->getMessage(), 500);
}
