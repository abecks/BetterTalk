(function($){
    $(document).ready(function(){
        $("#cancel", document).on('click', function(){
           self.close();
        });
    });

    window.nativeWindow.activate();
    window.nativeWindow.orderToFront();
    window.nativeWindow.alwaysInFront = true;
    window.nativeWindow.alwaysInFront = false;

})(window.opener.jQuery);