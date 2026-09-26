package ru.heatcalc.app;

import android.content.ActivityNotFoundException;
import android.content.ContentResolver;
import android.content.ContentValues;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.print.PrintAttributes;
import android.print.HcPdfPrint;
import android.print.PrintDocumentAdapter;
import android.provider.MediaStore;
import android.util.Base64;
import android.webkit.MimeTypeMap;
import android.webkit.WebView;

import androidx.core.content.FileProvider;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.OutputStream;
import java.util.Locale;

/**
 * Работа с файлами так, как её ждут от приложения, а не от вкладки браузера:
 * сохранить в «Загрузки», отправить в мессенджер, открыть в просмотрщике.
 *
 * Зачем вообще. Смета, счёт, договор и выгрузка в Excel собираются в браузерную
 * ссылку blob: и «скачиваются» щелчком по невидимой ссылке. В обычном браузере
 * это работает, а встроенный WebView такие ссылки не скачивает совсем: без
 * DownloadListener нажатие просто ничего не делает — крутится «Формируем PDF…»,
 * и файла нет. Capacitor своего обработчика не ставит, поэтому ставим свой.
 *
 * Плагин собственный, без пакета из npm: package-lock.json не трогаем, а
 * конвейер собирает проект командой npm ci, которой любое расхождение с
 * package.json — ошибка.
 *
 * Из разметки зовётся так:
 *     window.Capacitor.Plugins.HcNative.save({ name, mime, data })
 * где data — содержимое файла в base64. Регистрирует его MainActivity.
 */
@CapacitorPlugin(name = "HcNative")
public class HcNativePlugin extends Plugin {

    /** Папка внутри кэша, откуда файлы уходят в мессенджеры. */
    private static final String SHARE_DIR = "share";

    /**
     * Адрес, которым браузер разбудил приложение после входа через Яндекс ID.
     *
     * Поле общее на всё приложение: адрес приходит в MainActivity, а забирает
     * его страница — и, если приложение только что запустилось, забирает уже
     * после того, как разметка загрузилась. Иначе код авторизации пропал бы
     * в промежутке между запуском и готовностью страницы.
     */
    private static String pendingUrl;

    static void setPendingUrl(String url) {
        pendingUrl = url;
    }

    /** Отдаёт странице адрес возврата и забывает его: второй раз он не нужен. */
    @PluginMethod
    public void takeUrl(PluginCall call) {
        JSObject res = new JSObject();
        res.put("url", pendingUrl);
        pendingUrl = null;
        call.resolve(res);
    }

    /**
     * Кладёт файл в общую папку «Загрузки» — туда же, куда складывает файлы
     * браузер, и там его найдёт любой файловый менеджер.
     */
    @PluginMethod
    public void save(PluginCall call) {
        String name = safeName(call.getString("name", "file"));
        String mime = mimeFor(call.getString("mime"), name);
        byte[] bytes = decode(call.getString("data"));

        if (bytes == null) {
            call.reject("Пустое содержимое файла");
            return;
        }

        try {
            call.resolve(store(name, mime, bytes));
        } catch (Exception e) {
            // Причину прячем в журнал: человеку в окне она ничего не объяснит.
            call.reject("Не удалось сохранить файл", e);
        }
    }

    /**
     * Кладёт готовые байты в «Загрузки» и отвечает, куда именно легло.
     * Общий кусок для save() (файл собрал браузер) и printPdf() (файл собрал
     * Android): место хранения и способ отдать его наружу у них одинаковые.
     */
    private JSObject store(String name, String mime, byte[] bytes) throws Exception {
        {
            Uri uri;
            String where;

            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                // Android 10 и новее: пишем через общее хранилище, разрешений не
                // требуется. IS_PENDING прячет недописанный файл от других
                // программ — иначе файловый менеджер успевает показать обрезок.
                ContentResolver cr = getContext().getContentResolver();

                ContentValues values = new ContentValues();
                values.put(MediaStore.Downloads.DISPLAY_NAME, name);
                values.put(MediaStore.Downloads.MIME_TYPE, mime);
                values.put(MediaStore.Downloads.IS_PENDING, 1);

                uri = cr.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values);
                if (uri == null) {
                    throw new Exception("Хранилище не отдало место под файл");
                }

                OutputStream os = cr.openOutputStream(uri);
                if (os == null) {
                    throw new Exception("Не удалось открыть файл на запись");
                }
                try {
                    os.write(bytes);
                } finally {
                    os.close();
                }

                values.clear();
                values.put(MediaStore.Downloads.IS_PENDING, 0);
                cr.update(uri, values, null, null);

                where = "Загрузки";
            } else {
                // Android 9 и старше: общая папка требует разрешения на всю
                // память телефона. Просить его ради одного файла — перебор,
                // поэтому кладём в свою папку и отдаём наружу через провайдер:
                // «Поделиться» и «Открыть» работают так же.
                File dir = getContext().getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS);
                if (dir == null) {
                    throw new Exception("Внешнее хранилище недоступно");
                }
                if (!dir.exists() && !dir.mkdirs()) {
                    throw new Exception("Не удалось создать папку для файла");
                }

                File file = new File(dir, name);
                FileOutputStream fos = new FileOutputStream(file);
                try {
                    fos.write(bytes);
                } finally {
                    fos.close();
                }

                uri = provide(file);
                where = "Файлы приложения";
            }

            JSObject res = new JSObject();
            res.put("uri", uri.toString());
            res.put("name", name);
            res.put("mime", mime);
            res.put("where", where);
            return res;
        }
    }

    /**
     * Печать страницы в PDF силами самого Android.
     *
     * Зачем не как в браузере. На сайте PDF собирает html2pdf: он делает снимок
     * вёрстки в холст и кладёт картинку в документ. Смета на 30 с лишним листов —
     * это холст высотой под 76 000 точек, а встроенный браузер Android такой не
     * создаёт: возвращает пустой, и в файле выходят белые страницы. Плюс минуты
     * ожидания и вес в десятки мегабайт.
     *
     * WebView умеет печатать сам — тем же механизмом, что «Печать» в Chrome:
     * применяет @media print и отдаёт настоящий PDF с текстом, без холста.
     * Обычно его показывают в системном окне печати, но адаптер можно вызвать
     * напрямую и записать результат в файл.
     *
     * Страницу к печати готовит разметка (prepareForPrint в app.js) — здесь
     * только снимок того, что уже на экране.
     */
    @PluginMethod
    public void printPdf(final PluginCall call) {
        final String name = safeName(ensurePdf(call.getString("name", "Смета")));

        getActivity().runOnUiThread(new Runnable() {
            @Override
            public void run() {
                try {
                    WebView web = (WebView) getBridge().getWebView();
                    final PrintDocumentAdapter adapter =
                        web.createPrintDocumentAdapter(name.replace(".pdf", ""));

                    PrintAttributes attrs = new PrintAttributes.Builder()
                        .setMediaSize(PrintAttributes.MediaSize.ISO_A4)
                        .setResolution(new PrintAttributes.Resolution("pdf", "pdf", 300, 300))
                        .setMinMargins(PrintAttributes.Margins.NO_MARGINS)
                        .build();

                    final File out = new File(getContext().getCacheDir(), "print.pdf");
                    if (out.exists() && !out.delete()) {
                        call.reject("Не удалось освободить место под файл");
                        return;
                    }

                    // Сама печать — в HcPdfPrint: ответные объекты системного
                    // адаптера можно создавать только из пакета android.print.
                    HcPdfPrint.toFile(adapter, attrs, out, new HcPdfPrint.Done() {
                        @Override
                        public void ok(File file) {
                            finishPrint(call, file, name);
                        }

                        @Override
                        public void fail(String error) {
                            call.reject("Печать не удалась: " + error);
                        }
                    });
                } catch (Exception e) {
                    call.reject("Не удалось напечатать PDF", e);
                }
            }
        });
    }

    /** Готовый PDF из кэша перекладываем в «Загрузки» и убираем за собой. */
    private void finishPrint(PluginCall call, File out, String name) {
        try {
            int size = (int) out.length();
            if (size <= 0) {
                call.reject("Пустой файл печати");
                return;
            }
            byte[] bytes = new byte[size];
            FileInputStream in = new FileInputStream(out);
            try {
                int read = 0;
                while (read < size) {
                    int n = in.read(bytes, read, size - read);
                    if (n < 0) break;
                    read += n;
                }
            } finally {
                in.close();
            }
            JSObject res = store(name, "application/pdf", bytes);
            res.put("size", size);
            // Содержимое отдаём и разметке: кнопка «Поделиться» отправляет файл
            // в мессенджер тем же путём, что и остальные выгрузки. Огромные файлы
            // через мост не тащим — печатный PDF столько не весит, но мало ли.
            if (size <= 8 * 1024 * 1024) {
                res.put("data", Base64.encodeToString(bytes, Base64.NO_WRAP));
            }
            call.resolve(res);
        } catch (Exception e) {
            call.reject("Не удалось сохранить PDF", e);
        } finally {
            //noinspection ResultOfMethodCallIgnored
            out.delete();
        }
    }

    private static String ensurePdf(String name) {
        String n = (name == null || name.trim().isEmpty()) ? "Смета" : name.trim();
        return n.toLowerCase(Locale.ROOT).endsWith(".pdf") ? n : n + ".pdf";
    }

    /**
     * Системный лист «Поделиться»: смета уходит в WhatsApp, Telegram или почту
     * одним движением, без сохранения и поиска файла вручную.
     */
    @PluginMethod
    public void share(PluginCall call) {
        String name = safeName(call.getString("name", "file"));
        String mime = mimeFor(call.getString("mime"), name);
        String text = call.getString("text");
        byte[] bytes = decode(call.getString("data"));

        try {
            Intent send = new Intent(Intent.ACTION_SEND);
            send.setType(bytes == null ? "text/plain" : mime);

            if (bytes != null) {
                File dir = new File(getContext().getCacheDir(), SHARE_DIR);
                if (!dir.exists() && !dir.mkdirs()) {
                    call.reject("Не удалось подготовить файл к отправке");
                    return;
                }
                File file = new File(dir, name);
                FileOutputStream fos = new FileOutputStream(file);
                try {
                    fos.write(bytes);
                } finally {
                    fos.close();
                }
                send.putExtra(Intent.EXTRA_STREAM, provide(file));
                send.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            }

            if (text != null && !text.isEmpty()) {
                send.putExtra(Intent.EXTRA_TEXT, text);
            }

            Intent chooser = Intent.createChooser(send, "Отправить");
            chooser.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            getActivity().startActivity(chooser);
            call.resolve();
        } catch (Exception e) {
            call.reject("Не удалось отправить файл", e);
        }
    }

    /** Открывает уже сохранённый файл в подходящей программе. */
    @PluginMethod
    public void open(PluginCall call) {
        String uri = call.getString("uri");
        if (uri == null || uri.isEmpty()) {
            call.reject("Не указан файл");
            return;
        }

        Intent view = new Intent(Intent.ACTION_VIEW);
        view.setDataAndType(Uri.parse(uri), mimeFor(call.getString("mime"), uri));
        view.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);

        try {
            getActivity().startActivity(view);
            call.resolve();
        } catch (ActivityNotFoundException e) {
            // Штатный случай: PDF нечем открыть, программу для просмотра не
            // поставили. Сообщение показывает страница, ей и решать.
            call.reject("Нет программы для открытия этого файла", e);
        }
    }

    // ------------------------------------------------------------ мелочи

    private Uri provide(File file) {
        return FileProvider.getUriForFile(
                getContext(), getContext().getPackageName() + ".fileprovider", file);
    }

    private byte[] decode(String base64) {
        if (base64 == null || base64.isEmpty()) return null;
        try {
            return Base64.decode(base64, Base64.DEFAULT);
        } catch (IllegalArgumentException e) {
            return null;
        }
    }

    /**
     * Имя файла без разделителей пути: смета называется по объекту, а его имя
     * человек вводит сам и может поставить туда косую черту.
     */
    private String safeName(String name) {
        if (name == null || name.trim().isEmpty()) return "file";
        String clean = name.replaceAll("[\\\\/:*?\"<>|\\r\\n]", " ").trim();
        return clean.isEmpty() ? "file" : clean;
    }

    /** Если страница тип не назвала, выводим его из расширения. */
    private String mimeFor(String mime, String name) {
        if (mime != null && !mime.isEmpty()) return mime;

        int dot = name == null ? -1 : name.lastIndexOf('.');
        if (dot >= 0 && dot < name.length() - 1) {
            String ext = name.substring(dot + 1).toLowerCase(Locale.ROOT);
            String guess = MimeTypeMap.getSingleton().getMimeTypeFromExtension(ext);
            if (guess != null) return guess;
        }
        return "application/octet-stream";
    }
}
