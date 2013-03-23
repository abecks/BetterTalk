(function($,window,document,$window,$document,app){

    window.debug = {
        controls:{
            output: $("#output"),
            send: $("#send")
        },
        _init: function(){
            debug.controls.send.attr('contentEditable', true);
            debug.controls.send.on('keypress', function(e){
                if(e.keyCode == 13){
                    e.preventDefault();
                    var $this = $(this),
                        msg = $this.text();
                    $this.html('');
                    app.stream.send(msg);
                }
            });
        }
    };

    $document.ready(function(){
        debug._init();
    });
})(window.opener.jQuery,
    window,
    document,
    window.opener.jQuery(window),
    window.opener.jQuery(document),
    window.opener.app);