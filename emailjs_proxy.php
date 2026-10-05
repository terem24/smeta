<?php
/**
 * Proxy for EmailJS (api.emailjs.com).
 * Тот же приём, что и в supabase_proxy.php: у части пользователей в РФ провайдер блокирует/
 * дросселирует зарубежные сервисы, из-за чего браузер не может достучаться до api.emailjs.com
 * напрямую. Браузер обращается к этому скрипту, а сервер хостинга уже сам идёт в EmailJS
 * по своей сети. Клиент зовёт прокси только когда прямой путь не ответил (см. app.js,
 * installEmailjsProxy).
 *
 * Приватный ключ. Аккаунт EmailJS в строгом режиме: запрос не из браузера без приватного
 * ключа получает 403 «API access in strict mode, but no Private Key was provided». Так
 * прокси и отвечал с июля — никто не замечал, потому что клиентский перехват не работал
 * и до прокси ни одно письмо не доходило (разбор 15.09.2026). Ключ подставляется здесь,
 * на сервере, полем accessToken; в браузер и в репозиторий он не попадает. Лежит рядом
 * в emailjs_secret.php (файл в .gitignore, кладётся на Beget руками):
 *
 *     <?php return 'ПРИВАТНЫЙ_КЛЮЧ_ИЗ_КАБИНЕТА_EMAILJS';
 *
 * Нет файла — запрос уходит как раньше, без ключа, и получит тот же 403.
 *
 * Разрешённые сервис и шаблоны. С приватным ключом прокси становится дверью в наш почтовый
 * аккаунт, открытой для любого, кто знает адрес: без списка через него можно было бы слать
 * что угодно куда угодно и выжечь месячный лимит. Пропускаем только то, что шлёт сайт.
 * Новый шаблон в app.js — дописать сюда, иначе у заблокированных пользователей он не уйдёт.
 */

error_reporting(0);
ini_set('display_errors', 0);

header("Content-Type: application/json; charset=UTF-8");
header("Access-Control-Allow-Origin: *");
header("Access-Control-Allow-Methods: POST, OPTIONS");
header("Access-Control-Allow-Headers: Content-Type");

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    exit(0);
}

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    http_response_code(405);
    echo json_encode(["error" => "Method not allowed"]);
    exit;
}

$ALLOWED_SERVICES = ['service_o11b4ej'];
$ALLOWED_TEMPLATES = [
    'template_ysuxfio', // код подтверждения при регистрации и служебные уведомления
    'template_lg1zol9', // запрос счёта: письмо дистрибьютору со скрытой копией директору
];

// Разбираем в объекты, а не в массивы: иначе пустые {} в template_params при обратной
// сборке превратились бы в [], а EmailJS ждёт объект.
$payload = json_decode(file_get_contents('php://input'));
if (!is_object($payload)) {
    http_response_code(400);
    echo json_encode(["error" => "Bad request"]);
    exit;
}

$serviceId = isset($payload->service_id) ? (string)$payload->service_id : '';
$templateId = isset($payload->template_id) ? (string)$payload->template_id : '';
if (!in_array($serviceId, $ALLOWED_SERVICES, true) || !in_array($templateId, $ALLOWED_TEMPLATES, true)) {
    http_response_code(403);
    echo json_encode(["error" => "Template not allowed"]);
    exit;
}

// Ключ от клиента не принимаем никогда — только свой, с сервера.
unset($payload->accessToken);
$secretFile = __DIR__ . '/emailjs_secret.php';
if (is_file($secretFile)) {
    $privateKey = include $secretFile;
    if (is_string($privateKey) && $privateKey !== '') {
        $payload->accessToken = $privateKey;
    }
}

$ch = curl_init('https://api.emailjs.com/api/v1.0/email/send');
curl_setopt($ch, CURLOPT_POST, true);
curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode($payload, JSON_UNESCAPED_UNICODE));
curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
curl_setopt($ch, CURLOPT_HTTPHEADER, ['Content-Type: application/json']);
curl_setopt($ch, CURLOPT_TIMEOUT, 15);
curl_setopt($ch, CURLOPT_SSL_VERIFYPEER, true);
curl_setopt($ch, CURLOPT_SSL_VERIFYHOST, 2);

$response = curl_exec($ch);

if (curl_errno($ch)) {
    http_response_code(502);
    echo json_encode(["error" => "Proxy request failed: " . curl_error($ch)]);
    curl_close($ch);
    exit;
}

$httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
curl_close($ch);

http_response_code($httpCode);
echo $response;
