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
        $r = rows($db, "SELECT id, name, code, shortName FROM {$px}products WHERE is_deleted='No' AND status='1' ORDER BY name");
        ok(['products' => $r]);

    case 'vmm-sp-natures':
        $r = rows($db, "SELECT id, name FROM {$px}natureofproblem WHERE is_deleted='No' ORDER BY name");
        ok(['natures' => $r]);

    case 'vmm-sp-delay-reasons':
        $r = rows($db, "SELECT id, name, tat FROM {$px}delayreasons WHERE is_deleted='No' ORDER BY name");
        $s = rows($db, "SELECT id, reasonid, name FROM {$px}subdelayreasons WHERE is_deleted='No' ORDER BY name");
        ok(['reasons' => $r, 'subReasons' => $s]);

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
        // Generate complaint number
        q($db, "CALL generateReferenceNo(@lastid)");
        $r2 = row($db, "SELECT @lastid as cno");
        $base_no = date('ymd') . $r2['cno'];
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
                 productmodel,productlocation,typeofcomplaint,natureofproblem,tat,description,uid,created,updated,is_deleted)
                VALUES (
                '$complaintno',$storerefid,
                " . (int)($b['productid']??0) . ",'" . e($db,$b['productCode']??'') . "','" . e($db,$b['productname']??'') . "',
                '" . e($db,$b['producttype']??'') . "','" . e($db,$b['vendorName']??'') . "'," . (int)($b['vendorId']??0) . ",
                '" . e($db,$b['productModel']??'') . "','" . e($db,$b['productLocation']??'') . "',
                '" . e($db,$b['typeOfComplaints']??'') . "','" . e($db,$b['natureOfProblem']??'') . "',
                " . (int)($b['tat']??0) . ",'" . e($db,$b['description']??'') . "'," . (int)($b['uid']??1) . ",NOW(),NOW(),'No')";
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

        if ($closureStatus === 'Partially Closed' && $newEdc) {
            q($db, "INSERT INTO {$px}vendorescalations
                (logid,complaintid,escalationlevel,ticketno,closuredate,uid,uuid,created,updated,is_deleted)
                VALUES ($logid,$complaintId,$escLevel,'$vendorTicketNo','$newEdc',$uid,0,NOW(),NOW(),'No')");
        }
        ok(['complaintId' => $complaintId, 'closureStatus' => $closureStatus]);

    // ── Not connected ─────────────────────────────────────────────────────────
    case 'vmm-not-connected':
        if ($METHOD !== 'POST') fail('POST required');
        $b = $body;
        $complaintId = (int)($b['complaintId'] ?? 0);
        $uid = (int)($b['uid'] ?? 1);
        if (!$complaintId) fail('complaintId required');
        q($db, "INSERT INTO {$px}complaintlogs
            (complaintid,status,currentstatus,fupdonevia,remarks,uid,created,updated,is_deleted)
            VALUES ($complaintId,'Updated',1,'Call','Not Connected',$uid,NOW(),NOW(),'No')");
        ok();

    // ── Update EDC ────────────────────────────────────────────────────────────
    case 'vmm-update-edc':
        if ($METHOD !== 'POST') fail('POST required');
        $b = $body;
        $complaintId = (int)($b['complaintId'] ?? 0);
        $newEdc = e($db, $b['newClosureDate'] ?? '');
        if (!$complaintId || !$newEdc) fail('complaintId and newClosureDate required');
        $esc = row($db, "SELECT id FROM {$px}vendorescalations WHERE complaintid=$complaintId ORDER BY id DESC LIMIT 1");
        if ($esc) {
            q($db, "UPDATE {$px}vendorescalations SET closuredate='$newEdc' WHERE id=" . (int)$esc['id']);
        }
        ok();

    // ── Follow-up complaints list ──────────────────────────────────────────────
    case 'vmm-followup-complaints':
        $r = rows($db, "SELECT c.id, c.complaintno, c.productname, c.vendorname, c.created,
            s.storecode, s.storename, s.fmname,
            l.status, l.remarks, l.created as last_updated,
            esc.closuredate as edc, esc.ticketno, esc.escalationlevel
            FROM {$px}complaints c
            JOIN {$px}complaintstores s ON s.id=c.storerefid AND s.is_deleted='No'
            JOIN (SELECT * FROM {$px}complaintlogs l1 WHERE l1.id=(SELECT MAX(id) FROM {$px}complaintlogs l2 WHERE l2.complaintid=l1.complaintid AND l2.is_deleted='No')) l ON l.complaintid=c.id
            LEFT JOIN (SELECT * FROM {$px}vendorescalations e1 WHERE e1.id=(SELECT MAX(id) FROM {$px}vendorescalations e2 WHERE e2.complaintid=e1.complaintid AND e2.is_deleted='No')) esc ON esc.complaintid=c.id
            WHERE c.is_deleted='No' AND l.status NOT IN ('Closed')
            ORDER BY c.id DESC");
        ok(['complaints' => $r]);

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
        $u = row($db, "SELECT id, name, email, role FROM {$px}users WHERE email='$email' AND is_deleted='No' AND status='1' LIMIT 1");
        if (!$u) fail('User not found', 404);
        ok(['user' => $u, 'role' => $u['role']]);

    // ── SparkTG inbound ───────────────────────────────────────────────────────
    case 'vmm-sparktg-inbound':
        $mobile = e($db, $GET['mobile'] ?? '');
        if (!$mobile) fail('mobile required');
        $emp = row($db, "SELECT id, code, name, mobileno, email, designation FROM {$px}employees WHERE mobileno='$mobile' AND is_deleted='No' AND status='1' LIMIT 1");
        $store = null;
        if ($emp) {
            $store = row($db, "SELECT s.id, s.code, s.name FROM {$px}stores s
                JOIN {$px}complaintstores cs ON cs.storeid=s.id AND cs.empid={$emp['id']}
                WHERE s.is_deleted='No' ORDER BY cs.id DESC LIMIT 1");
        }
        ok(['employee' => $emp, 'store' => $store]);

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
