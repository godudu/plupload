/**
 * plupload.html5.js
 *
 * Copyright 2009, Moxiecode Systems AB
 * Released under GPL License.
 *
 * License: http://www.plupload.com/license
 * Contributing: http://www.plupload.com/contributing
 */

// JSLint defined globals
/*global plupload:false, File:false, window:false, atob:false, FormData:false, FileReader:false, ArrayBuffer:false, Uint8Array:false, BlobBuilder:false, unescape:false */
define(['libs/plupload'], function (plupload) {

    (function (window, document) {
        var html5files = {}, // queue of original File objects
            fakeSafariDragDrop;

        /**
         * HMTL5 implementation. This runtime supports these features: dragdrop.
         *
         * @static
         * @class plupload.runtimes.Html5
         * @extends plupload.Runtime
         */
        plupload.runtimes.Html5 = plupload.addRuntime("html5", {
            /**
             * Returns a list of supported features for the runtime.
             *
             * @return {Object} Name/value object with supported features.
             */
            getFeatures: function () {
                var xhr, hasXhrSupport, hasProgress, canSendBinary, dataAccessSupport, sliceSupport, canSendBlobInFormData;

                hasXhrSupport = hasProgress = dataAccessSupport = sliceSupport = false;

                if (window.XMLHttpRequest) {
                    xhr = new XMLHttpRequest();
                    hasProgress = !!xhr.upload;
                    hasXhrSupport = !!(xhr.sendAsBinary || xhr.upload);
                }

                // Check for support for various features
                if (hasXhrSupport) {
                    canSendBinary = !!(xhr.sendAsBinary || (window.Uint8Array && window.ArrayBuffer));

                    // Set dataAccessSupport only for Gecko since BlobBuilder and XHR doesn't handle binary data correctly				
                    dataAccessSupport = !!(File && (File.prototype.getAsDataURL || window.FileReader) && canSendBinary);
                    sliceSupport = !!(File && (File.prototype.mozSlice || File.prototype.webkitSlice || File.prototype.slice));
                }

                // sniff out Safari for Windows and fake drag/drop
                fakeSafariDragDrop = plupload.ua.safari && plupload.ua.windows;

                // Checking for FormData Blob support
                canSendBlobInFormData =
                    !(plupload.ua.gecko && window.FormData && window.FileReader && !FileReader.prototype.readAsArrayBuffer) || plupload.ua.android;
                if (canSendBlobInFormData) {
                    // Another check for Opera (throws NOT_SUPPORTED_ERR)
                    try {
                        (new FormData()).append(new Blob());
                    } catch (e) {
                        canSendBlobInFormData = false;
                    }
                }

                return {
                    html5: hasXhrSupport, // This is a special one that we check inside the init call
                    dragdrop: (function () {
                        // this comes directly from Modernizr: http://www.modernizr.com/
                        var div = document.createElement('div');
                        return ('draggable' in div) || ('ondragstart' in div && 'ondrop' in div);
                    }()),
                    jpgresize: false,
                    pngresize: false,
                    multipart: dataAccessSupport || !!window.FileReader || !!window.FormData,
                    canSendBinary: canSendBinary,
                    // gecko 2/5/6 can't send blob with FormData: https://bugzilla.mozilla.org/show_bug.cgi?id=649150 
                    // Android browsers (default one and Dolphin) seem to have the same issue, see: #613
                    cantSendBlobInFormData: !canSendBlobInFormData,
                    progress: hasProgress,
                    chunks: sliceSupport,
                    // Safari on Windows has problems when selecting multiple files
                    multi_selection: !(plupload.ua.safari && plupload.ua.windows),
                    // WebKit, Gecko 2+ and IE10 can trigger file dialog programmatically
                    triggerDialog: plupload.ua.webkit || (window.FormData && (plupload.ua.gecko || plupload.ua.ie))
                };
            },

            /**
             * Initializes the upload runtime.
             *
             * @method init
             * @param {plupload.Uploader} uploader Uploader instance that needs to be initialized.
             * @param {function} callback Callback to execute when the runtime initializes or fails to initialize. If it succeeds an object with a parameter name success will be set to true.
             */
            init: function (uploader, callback) {
                var features, xhr;

                function addSelectedFiles(native_files) {
                    var file, i, files = [], id, fileNames = {};

                    // Add the selected files to the file queue
                    for (i = 0; i < native_files.length; i++) {
                        file = native_files[i];

                        // Safari on Windows will add first file from dragged set multiple times
                        // @see: https://bugs.webkit.org/show_bug.cgi?id=37957
                        if (fileNames[file.name]) {
                            continue;
                        }
                        fileNames[file.name] = true;

                        // Store away gears blob internally
                        id = plupload.guid();
                        html5files[id] = file;

                        // Expose id, name and size
                        files.push(new plupload.File(id, file.fileName || file.name, file.fileSize || file.size)); // fileName / fileSize depricated
                    }

                    // Trigger FilesAdded event if we added any
                    if (files.length) {
                        uploader.trigger("FilesAdded", files);
                    }
                }

                // No HTML5 upload support
                features = this.getFeatures();
                if (!features.html5) {
                    callback({success: false});
                    return;
                }

                uploader.bind("Init", function (up) {
                    var inputContainer, browseButton, mimes = [], i, y, filters = up.settings.filters, ext, type, container = document.body, inputFile;

                    // Create input container and insert it at an absolute position within the browse button
                    inputContainer = document.createElement('div');
                    inputContainer.id = up.id + '_html5_container';

                    plupload.extend(inputContainer.style, {
                        position: 'absolute',
                        background: uploader.settings.shim_bgcolor || 'transparent',
                        width: '100px',
                        height: '100px',
                        overflow: 'hidden',
                        zIndex: 99999,
                        opacity: uploader.settings.shim_bgcolor ? '' : 0 // Force transparent if bgcolor is undefined
                    });
                    inputContainer.className = 'plupload html5';

                    if (uploader.settings.container) {
                        container = document.getElementById(uploader.settings.container);
                        if (plupload.getStyle(container, 'position') === 'static') {
                            container.style.position = 'relative';
                        }
                    }

                    container.appendChild(inputContainer);

                    // Convert extensions to mime types list
                    no_type_restriction:
                        for (i = 0; i < filters.length; i++) {
                            ext = filters[i].extensions.split(/,/);

                            for (y = 0; y < ext.length; y++) {

                                // If there's an asterisk in the list, then accept attribute is not required
                                if (ext[y] === '*') {
                                    mimes = [];
                                    break no_type_restriction;
                                }

                                type = plupload.mimeTypes[ext[y]];

                                if (type && plupload.inArray(type, mimes) === -1) {
                                    mimes.push(type);
                                }
                            }
                        }


                    // Insert the input inside the input container
                    inputContainer.innerHTML = '<input id="' + uploader.id + '_html5" ' + ' style="font-size:999px"' +
                        ' type="file" accept="' + mimes.join(',') + '" ' +
                        (uploader.settings.multi_selection && uploader.features.multi_selection ? 'multiple="multiple"' : '') + ' />';

                    inputContainer.scrollTop = 100;
                    inputFile = document.getElementById(uploader.id + '_html5');

                    if (up.features.triggerDialog) {
                        plupload.extend(inputFile.style, {
                            position: 'absolute',
                            width: '100%',
                            height: '100%'
                        });
                    } else {
                        // shows arrow cursor instead of the text one, bit more logical
                        plupload.extend(inputFile.style, {
                            cssFloat: 'right',
                            styleFloat: 'right'
                        });
                    }

                    inputFile.onchange = function () {
                        // Add the selected files from file input
                        addSelectedFiles(this.files);

                        // Clearing the value enables the user to select the same file again if they want to
                        this.value = '';
                    };

                    /* Since we have to place input[type=file] on top of the browse_button for some browsers (FF, Opera),
                     browse_button loses interactivity, here we try to neutralize this issue highlighting browse_button
                     with a special classes
                     TODO: needs to be revised as things will change */
                    browseButton = document.getElementById(up.settings.browse_button);
                    if (browseButton) {
                        var hoverClass = up.settings.browse_button_hover,
                            activeClass = up.settings.browse_button_active,
                            topElement = up.features.triggerDialog ? browseButton : inputContainer;

                        if (hoverClass) {
                            plupload.addEvent(topElement, 'mouseover', function () {
                                plupload.addClass(browseButton, hoverClass);
                            }, up.id);
                            plupload.addEvent(topElement, 'mouseout', function () {
                                plupload.removeClass(browseButton, hoverClass);
                            }, up.id);
                        }

                        if (activeClass) {
                            plupload.addEvent(topElement, 'mousedown', function () {
                                plupload.addClass(browseButton, activeClass);
                            }, up.id);
                            plupload.addEvent(document.body, 'mouseup', function () {
                                plupload.removeClass(browseButton, activeClass);
                            }, up.id);
                        }

                        // Route click event to the input[type=file] element for supporting browsers
                        if (up.features.triggerDialog) {
                            plupload.addEvent(browseButton, 'click', function (e) {
                                var input = document.getElementById(up.id + '_html5');
                                if (input && !input.disabled) { // for some reason FF (up to 8.0.1 so far) lets to click disabled input[type=file]
                                    input.click();
                                }
                                e.preventDefault();
                            }, up.id);
                        }
                    }
                });

                // Add drop handler
                uploader.bind("PostInit", function () {
                    var dropElm = document.getElementById(uploader.settings.drop_element);

                    if (dropElm) {
                        // Lets fake drag/drop on Safari by moving a input type file in front of the mouse pointer when we drag into the drop zone
                        // TODO: Remove this logic once Safari has official drag/drop support
                        if (fakeSafariDragDrop) {
                            plupload.addEvent(dropElm, 'dragenter', function () {
                                var dropInputElm, dropPos, dropSize;

                                // Get or create drop zone
                                dropInputElm = document.getElementById(uploader.id + "_drop");
                                if (!dropInputElm) {
                                    dropInputElm = document.createElement("input");
                                    dropInputElm.setAttribute('type', "file");
                                    dropInputElm.setAttribute('id', uploader.id + "_drop");
                                    dropInputElm.setAttribute('multiple', 'multiple');

                                    plupload.addEvent(dropInputElm, 'change', function () {
                                        // Add the selected files from file input
                                        addSelectedFiles(this.files);

                                        // Remove input element
                                        plupload.removeEvent(dropInputElm, 'change', uploader.id);
                                        dropInputElm.parentNode.removeChild(dropInputElm);
                                    }, uploader.id);

                                    // avoid event propagation as Safari cancels the whole capability of dropping files if you are doing a preventDefault of this event on the document body
                                    plupload.addEvent(dropInputElm, 'dragover', function (e) {
                                        e.stopPropagation();
                                    }, uploader.id);

                                    dropElm.appendChild(dropInputElm);
                                }

                                dropPos = plupload.getPos(dropElm, document.getElementById(uploader.settings.container));
                                dropSize = plupload.getSize(dropElm);

                                if (plupload.getStyle(dropElm, 'position') === 'static') {
                                    plupload.extend(dropElm.style, {
                                        position: 'relative'
                                    });
                                }

                                plupload.extend(dropInputElm.style, {
                                    position: 'absolute',
                                    display: 'block',
                                    top: 0,
                                    left: 0,
                                    width: dropSize.w + 'px',
                                    height: dropSize.h + 'px',
                                    opacity: 0
                                });
                            }, uploader.id);

                            return;
                        }

                        // Block browser default drag over
                        plupload.addEvent(dropElm, 'dragover', function (e) {
                            e.preventDefault();
                            e.dataTransfer.dropEffect = 'copy';
                        }, uploader.id);

                        // Attach drop handler and grab files
                        plupload.addEvent(dropElm, 'drop', function (e) {
                            var dataTransfer = e.dataTransfer;

                            // Add dropped files
                            if (dataTransfer && dataTransfer.files) {
                                addSelectedFiles(dataTransfer.files);
                            }

                            e.preventDefault();
                        }, uploader.id);
                    }
                });

                uploader.bind("Refresh", function (up) {
                    var browseButton, browsePos, browseSize, inputContainer, zIndex;

                    browseButton = document.getElementById(uploader.settings.browse_button);
                    if (browseButton) {
                        browsePos = plupload.getPos(browseButton, document.getElementById(up.settings.container));
                        browseSize = plupload.getSize(browseButton);
                        inputContainer = document.getElementById(uploader.id + '_html5_container');

                        plupload.extend(inputContainer.style, {
                            top: browsePos.y + 'px',
                            left: browsePos.x + 'px',
                            width: browseSize.w + 'px',
                            height: browseSize.h + 'px'
                        });

                        // for WebKit place input element underneath the browse button and route onclick event 
                        // TODO: revise when browser support for this feature will change
                        if (uploader.features.triggerDialog) {
                            if (plupload.getStyle(browseButton, 'position') === 'static') {
                                plupload.extend(browseButton.style, {
                                    position: 'relative'
                                });
                            }

                            zIndex = parseInt(plupload.getStyle(browseButton, 'zIndex'), 10);
                            if (isNaN(zIndex)) {
                                zIndex = 0;
                            }

                            plupload.extend(browseButton.style, {
                                zIndex: zIndex
                            });

                            plupload.extend(inputContainer.style, {
                                zIndex: zIndex - 1
                            });
                        }
                    }
                });

                uploader.bind("DisableBrowse", function (up, disabled) {
                    var input = document.getElementById(up.id + '_html5');
                    if (input) {
                        input.disabled = disabled;
                    }
                });

                uploader.bind("CancelUpload", function () {
                    if (xhr && xhr.abort) {
                        xhr.abort();
                    }
                });

                uploader.bind("UploadFile", function (up, file) {
                    var settings = up.settings, nativeFile;

                    function w3cBlobSlice(blob, start, end) {
                        var blobSlice;

                        if (File.prototype.slice) {
                            try {
                                blob.slice();	// depricated version will throw WRONG_ARGUMENTS_ERR exception
                                return blob.slice(start, end);
                            } catch (e) {
                                // depricated slice method
                                return blob.slice(start, end - start);
                            }
                            // slice method got prefixed: https://bugzilla.mozilla.org/show_bug.cgi?id=649672	
                        } else if (blobSlice = File.prototype.webkitSlice || File.prototype.mozSlice) {
                            return blobSlice.call(blob, start, end);
                        } else {
                            return null; // or throw some exception	
                        }
                    }

                    function sendBinaryBlob(blob) {
                        var chunk = 0, loaded = 0;


                        function uploadNextChunk() {
                            var chunkBlob, chunks, args, chunkSize, curChunkSize, mimeType, url = up.settings.url;

                            function sendAsBinaryString(bin) {
                                if (xhr.sendAsBinary) { // Gecko
                                    xhr.sendAsBinary(bin);
                                } else if (up.features.canSendBinary) { // WebKit with typed arrays support
                                    var ui8a = new Uint8Array(bin.length);
                                    for (var i = 0; i < bin.length; i++) {
                                        ui8a[i] = (bin.charCodeAt(i) & 0xff);
                                    }
                                    xhr.send(ui8a.buffer);
                                }
                            }

                            function prepareAndSend(bin) {
                                var multipartDeltaSize = 0,
                                    boundary = '----pluploadboundary' + plupload.guid(), formData, dashdash = '--', crlf = '\r\n', multipartBlob = '';

                                xhr = new XMLHttpRequest();

                                // Do we have upload progress support
                                if (xhr.upload) {
                                    xhr.upload.onprogress = function (e) {
                                        file.loaded = Math.min(file.size, loaded + e.loaded - multipartDeltaSize); // Loaded can be larger than file size due to multipart encoding
                                        up.trigger('UploadProgress', file);
                                    };
                                }

                                xhr.onreadystatechange = function () {
                                    var httpStatus, chunkArgs;

                                    if (xhr.readyState == 4 && up.state !== plupload.STOPPED) {
                                        // Getting the HTTP status might fail on some Gecko versions
                                        try {
                                            httpStatus = xhr.status;
                                        } catch (ex) {
                                            httpStatus = 0;
                                        }

                                        // Is error status
                                        if (httpStatus >= 400) {
                                            up.trigger('Error', {
                                                code: plupload.HTTP_ERROR,
                                                message: plupload.translate('HTTP Error.'),
                                                file: file,
                                                status: httpStatus
                                            });
                                        } else {
                                            // Handle chunk response
                                            if (chunks) {
                                                chunkArgs = {
                                                    chunk: chunk,
                                                    chunks: chunks,
                                                    response: xhr.responseText,
                                                    status: httpStatus
                                                };

                                                up.trigger('ChunkUploaded', file, chunkArgs);
                                                loaded += curChunkSize;

                                                // Stop upload
                                                if (chunkArgs.cancelled) {
                                                    file.status = plupload.FAILED;
                                                    return;
                                                }

                                                file.loaded = Math.min(file.size, (chunk + 1) * chunkSize);
                                            } else {
                                                file.loaded = file.size;
                                            }

                                            up.trigger('UploadProgress', file);

                                            bin = chunkBlob = formData = multipartBlob = null; // Free memory

                                            // Check if file is uploaded
                                            if (!chunks || ++chunk >= chunks) {
                                                file.status = plupload.DONE;

                                                up.trigger('FileUploaded', file, {
                                                    response: xhr.responseText,
                                                    status: httpStatus
                                                });
                                            } else {
                                                // Still chunks left
                                                uploadNextChunk();
                                            }
                                        }
                                    }
                                };


                                // Build multipart request
                                if (up.settings.multipart && features.multipart) {

                                    args.name = file.target_name || file.name;

                                    xhr.open("post", url, true);

                                    // Set custom headers
                                    plupload.each(up.settings.headers, function (value, name) {
                                        xhr.setRequestHeader(name, value);
                                    });


                                    // if has FormData support like Chrome 6+, Safari 5+, Firefox 4, use it
                                    if (typeof(bin) !== 'string' && !!window.FormData) {
                                        formData = new FormData();

                                        // Add multipart params
                                        plupload.each(plupload.extend(args, up.settings.multipart_params), function (value, name) {
                                            formData.append(name, value);
                                        });

                                        // Add file and send it
                                        formData.append(up.settings.file_data_name, bin);
                                        xhr.send(formData);

                                        return;
                                    }  // if no FormData we can still try to send it directly as last resort (see below)


                                    if (typeof(bin) === 'string') {
                                        // Trying to send the whole thing as binary...

                                        // multipart request
                                        xhr.setRequestHeader('Content-Type', 'multipart/form-data; boundary=' + boundary);

                                        // append multipart parameters
                                        plupload.each(plupload.extend(args, up.settings.multipart_params), function (value, name) {
                                            multipartBlob += dashdash + boundary + crlf +
                                                'Content-Disposition: form-data; name="' + name + '"' + crlf + crlf;

                                            multipartBlob += unescape(encodeURIComponent(value)) + crlf;
                                        });

                                        mimeType = plupload.mimeTypes[file.name.replace(/^.+\.([^.]+)/, '$1').toLowerCase()] || 'application/octet-stream';

                                        // Build RFC2388 blob
                                        multipartBlob += dashdash + boundary + crlf +
                                            'Content-Disposition: form-data; name="' + up.settings.file_data_name + '"; filename="'
                                            + unescape(encodeURIComponent(file.name)) + '"' + crlf +
                                            'Content-Type: ' + mimeType + crlf + crlf +
                                            bin + crlf +
                                            dashdash + boundary + dashdash + crlf;

                                        multipartDeltaSize = multipartBlob.length - bin.length;
                                        bin = multipartBlob;

                                        sendAsBinaryString(bin);
                                        return; // will return from here only if shouldn't send binary
                                    }
                                }

                                // if no multipart, or last resort, send as binary stream
                                url = plupload.buildUrl(up.settings.url, plupload.extend(args, up.settings.multipart_params));

                                xhr.open("post", url, true);

                                xhr.setRequestHeader('Content-Type', 'application/octet-stream'); // Binary stream header

                                // Set custom headers
                                plupload.each(up.settings.headers, function (value, name) {
                                    xhr.setRequestHeader(name, value);
                                });

                                if (typeof(bin) === 'string') {
                                    sendAsBinaryString(bin);
                                } else {
                                    xhr.send(bin);
                                }
                            } // prepareAndSend


                            // File upload finished
                            if (file.status == plupload.DONE || file.status == plupload.FAILED || up.state == plupload.STOPPED) {
                                return;
                            }

                            // Standard arguments
                            args = {name: file.target_name || file.name};

                            // Only add chunking args if needed
                            if (settings.chunk_size && file.size > settings.chunk_size && (features.chunks || typeof(blob) == 'string')) { // blob will be of type string if it was loaded in memory 
                                chunkSize = settings.chunk_size;
                                chunks = Math.ceil(file.size / chunkSize);
                                curChunkSize = Math.min(chunkSize, file.size - (chunk * chunkSize));

                                // Blob is string so we need to fake chunking, this is not
                                // ideal since the whole file is loaded into memory
                                if (typeof(blob) == 'string') {
                                    chunkBlob = blob.substring(chunk * chunkSize, chunk * chunkSize + curChunkSize);
                                } else {
                                    // Slice the chunk
                                    chunkBlob = w3cBlobSlice(blob, chunk * chunkSize, chunk * chunkSize + curChunkSize);
                                }

                                // Setup query string arguments
                                args.chunk = chunk;
                                args.chunks = chunks;
                            } else {
                                curChunkSize = file.size;
                                chunkBlob = blob;
                            }

                            // workaround for Android and Gecko 2,5,6 FormData+Blob bug: https://bugzilla.mozilla.org/show_bug.cgi?id=649150
                            if (up.settings.multipart && features.multipart && typeof(chunkBlob) !== 'string' && window.FileReader &&
                                features.cantSendBlobInFormData && features.chunks && up.settings.chunk_size) { // Gecko 2,5,6
                                (function () {
                                    var fr = new FileReader(); // we need to recreate FileReader object in Android, otherwise it hangs
                                    fr.onload = function () {
                                        prepareAndSend(fr.result);
                                        fr = null; // maybe give a hand to GC (Gecko had problems with this)
                                    };
                                    fr.readAsBinaryString(chunkBlob);
                                }());
                            } else {
                                prepareAndSend(chunkBlob);
                            }
                        }

                        // Start uploading chunks
                        uploadNextChunk();
                    }

                    nativeFile = html5files[file.id];

                    sendBinaryBlob(nativeFile);
                });


                uploader.bind('Destroy', function (up) {
                    var name, element, container = document.body,
                        elements = {
                            inputContainer: up.id + '_html5_container',
                            inputFile: up.id + '_html5',
                            browseButton: up.settings.browse_button,
                            dropElm: up.settings.drop_element
                        };

                    // Unbind event handlers
                    for (name in elements) {
                        element = document.getElementById(elements[name]);
                        if (element) {
                            plupload.removeAllEvents(element, up.id);
                        }
                    }
                    plupload.removeAllEvents(document.body, up.id);

                    if (up.settings.container) {
                        container = document.getElementById(up.settings.container);
                    }

                    // Remove mark-up
                    container.removeChild(document.getElementById(elements.inputContainer));
                });

                callback({success: true});
            }
        });

    })(window, document);

});