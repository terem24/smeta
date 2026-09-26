package android.print;

import android.os.Bundle;
import android.os.CancellationSignal;
import android.os.ParcelFileDescriptor;

import java.io.File;

/**
 * Печать WebView в файл, без системного окна печати.
 *
 * Почему в пакете android.print. Чтобы напечатать страницу в PDF, надо позвать
 * PrintDocumentAdapter.onLayout и onWrite и передать им ответные объекты
 * LayoutResultCallback и WriteResultCallback. Конструкторы у обоих
 * пакетно-приватные: унаследоваться от них можно только из того же пакета.
 * Отсюда и этот файл — он лежит в android.print, а не в ru.heatcalc.app.
 * Больше здесь ничего нет: вся работа с файлами осталась в HcNativePlugin.
 */
public final class HcPdfPrint {

    /** Кому сообщить о результате: печать асинхронная. */
    public interface Done {
        void ok(File file);

        void fail(String error);
    }

    private HcPdfPrint() { }

    public static void toFile(final PrintDocumentAdapter adapter,
                              final PrintAttributes attrs,
                              final File out,
                              final Done done) {
        final ParcelFileDescriptor pfd;
        try {
            pfd = ParcelFileDescriptor.open(
                out,
                ParcelFileDescriptor.MODE_READ_WRITE
                    | ParcelFileDescriptor.MODE_CREATE
                    | ParcelFileDescriptor.MODE_TRUNCATE);
        } catch (Exception e) {
            done.fail(String.valueOf(e));
            return;
        }

        try {
            adapter.onLayout(null, attrs, new CancellationSignal(),
                new PrintDocumentAdapter.LayoutResultCallback() {
                    @Override
                    public void onLayoutFinished(PrintDocumentInfo info, boolean changed) {
                        adapter.onWrite(new PageRange[]{ PageRange.ALL_PAGES }, pfd,
                            new CancellationSignal(),
                            new PrintDocumentAdapter.WriteResultCallback() {
                                @Override
                                public void onWriteFinished(PageRange[] pages) {
                                    close(pfd);
                                    done.ok(out);
                                }

                                @Override
                                public void onWriteFailed(CharSequence error) {
                                    close(pfd);
                                    done.fail(String.valueOf(error));
                                }
                            });
                    }

                    @Override
                    public void onLayoutFailed(CharSequence error) {
                        close(pfd);
                        done.fail(String.valueOf(error));
                    }
                }, new Bundle());
        } catch (Exception e) {
            close(pfd);
            done.fail(String.valueOf(e));
        }
    }

    private static void close(ParcelFileDescriptor pfd) {
        try {
            if (pfd != null) pfd.close();
        } catch (Exception ignored) { }
    }
}
