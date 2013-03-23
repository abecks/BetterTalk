(function($,air){
    $(document).ready(function(){
        $("#quit", document).on('click', function(){
            air.NativeApplication.nativeApplication.exit();
        }).focus();

        $("#cancel", document).on('click', function(){
           self.close();
        });
    });

    window.nativeWindow.activate();
    window.nativeWindow.orderToFront();
    window.nativeWindow.alwaysInFront = true;
    window.nativeWindow.alwaysInFront = false;

})(window.opener.jQuery,window.opener.air);